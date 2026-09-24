import * as THREE from 'three';
import { worldUniforms } from '../materials';

/**
 * Shader patches shared by the vegetation materials (MeshStandardMaterial / MeshDepthMaterial via onBeforeCompile):
 *
 *  wind      hierarchical sway from the per-vertex `wind` attribute (x trunk sway, y branch bob, z leaf flutter,
 *            w phase); phase also varies per instance; wind blows along a fixed world direction.
 *  fade      LOD cross-fade: a per-instance code in the BatchedMesh colour alpha (f >= 0: visible where the
 *            screen-space noise < f; f < 0: visible where noise >= -1 - f) so two LODs dissolve into each other.
 *  leaf      alpha-coverage fix for distant mips, no back-face normal flip (canopy normals), and a cheap
 *            translucency term added to every direct light (back-lit leaves glow, sun and street lamps alike).
 *  barkAtlas bark UVs carry the atlas column in uv.x (col * 16 + u); sampled with textureGrad so the column
 *            wrap has no mip seam.
 */
export interface VegPatch {
  wind?: boolean;
  fade?: boolean;
  leaf?: boolean;
  barkAtlas?: boolean;
  /** Leaf translucency strength (0..1). */
  trans?: number;
  /** Atlas size for the mip alpha fix. */
  mapSize?: number;
}

export const WIND_DIR = new THREE.Vector2(0.8, 0.6).normalize();

export const windParsVertex = /* glsl */ `
attribute vec4 wind;
uniform float uTime; uniform float uWind; uniform vec2 uWindDir;
vec3 vegWind(vec3 p, vec4 w, mat4 inst) {
  vec3 ip = inst[3].xyz;
  float ph = ip.x * 0.071 + ip.z * 0.093;
  vec3 wo = normalize(transpose(mat3(inst)) * vec3(uWindDir.x, 0.0, uWindDir.y));
  float gust = 0.55 + 0.45 * sin(uTime * 0.31 + ph * 0.7) * sin(uTime * 0.17 + ph);
  float s = (sin(uTime * 0.83 + ph) * 0.65 + sin(uTime * 1.71 + ph * 1.3) * 0.35) * gust + 0.35 * gust;
  vec3 d = wo * s * w.x * 0.22;
  float b = sin(uTime * 2.1 + w.w * 6.2831 + ph) * (0.6 + 0.4 * gust);
  d += (wo * 0.6 + vec3(0.0, 0.8, 0.0)) * b * w.y * 0.07;
  float f = sin(uTime * 7.3 + w.w * 37.0 + p.x * 2.1 + p.z * 1.7) * gust;
  d += vec3(0.35, 1.0, 0.25) * f * w.z * 0.05;
  return p + d * uWind;
}
`;

const instMat = /* glsl */ `
  mat4 vegInst = mat4(1.0);
  #ifdef USE_INSTANCING
    vegInst = instanceMatrix;
  #endif
  #ifdef USE_BATCHING
    vegInst = batchingMatrix;
  #endif
`;

const ign = /* glsl */ `float vegIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`;

export function patchVegetation(mat: THREE.MeshStandardMaterial | THREE.MeshDepthMaterial, o: VegPatch): void {
  const trans = o.trans ?? 0.6;
  const mapSize = o.mapSize ?? 2048;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uTime = worldUniforms.uTime;
    shader.uniforms.uWind = worldUniforms.uWind;
    shader.uniforms.uWindDir = { value: WIND_DIR };
    shader.uniforms.uMapSize = { value: mapSize };
    shader.uniforms.uLeafTrans = { value: trans };
    let vs = shader.vertexShader;
    let fs = shader.fragmentShader;
    const fadeVarying = o.fade ? 'varying float vFade;\n' : '';
    vs = vs.replace('#include <common>', `#include <common>\n${o.wind ? windParsVertex : ''}${fadeVarying}`);
    if (o.wind) {
      vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>\n{\n${instMat}\n  transformed = vegWind(transformed, wind, vegInst);\n}`);
    }
    if (o.fade) {
      // capture the batching colour alpha (LOD fade code) and keep it out of the diffuse alpha
      const cap = `\n#ifdef USE_BATCHING_COLOR\n  vFade = getBatchingColor( getIndirectIndex( gl_DrawID ) ).a;\n  vColor.a = 1.0;\n#else\n  vFade = 1.0;\n#endif\n`;
      if (vs.includes('#include <color_vertex>')) vs = vs.replace('#include <color_vertex>', `#include <color_vertex>${cap}`);
      else vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>\n#ifdef USE_BATCHING_COLOR\n  vFade = getBatchingColor( getIndirectIndex( gl_DrawID ) ).a;\n#else\n  vFade = 1.0;\n#endif\n`);
      fs = fs.replace('#include <common>', `#include <common>\n${fadeVarying}${ign}`);
      const fadeCode = `\n{ float n = vegIgn(gl_FragCoord.xy);\n  if (vFade >= 0.0) { if (n >= vFade) discard; } else { if (n < -1.0 - vFade) discard; } }\n`;
      if (fs.includes('#include <alphatest_fragment>')) fs = fs.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>${fadeCode}`);
      else fs = fs.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>${fadeCode}`);
    }
    if (o.leaf) {
      fs = fs.replace('#include <common>', `#include <common>\nuniform float uMapSize; uniform float uLeafTrans;`);
      fs = fs.replace('#include <map_fragment>', /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  { vec2 dx = dFdx( vMapUv * uMapSize ), dy = dFdy( vMapUv * uMapSize );
    float lod = 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) );
    sampledDiffuseColor.a *= 1.0 + max( lod, 0.0 ) * 0.3; }
  diffuseColor *= sampledDiffuseColor;
#endif`);
      if (fs.includes('#include <normal_fragment_begin>')) {
        fs = fs.replace('#include <normal_fragment_begin>', ShaderChunkNoFlip());
      }
      if (fs.includes('#include <lights_physical_pars_fragment>')) {
        fs = fs.replace('#include <lights_physical_pars_fragment>', /* glsl */ `#include <lights_physical_pars_fragment>
float vegTransMask = 1.0;
void RE_Direct_Leaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float back = pow( saturate( dot( geometryViewDir, - directLight.direction ) ), 4.0 );
  float thru = saturate( dot( - geometryNormal, directLight.direction ) );
  reflectedLight.directDiffuse += directLight.color * material.diffuseColor * ( uLeafTrans * vegTransMask ) * ( back * 0.6 + thru * 0.3 );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Leaf`);
      }
    }
    if (o.barkAtlas) {
      fs = fs.replace('#include <map_fragment>', /* glsl */ `
vec2 barkAuv = vec2( 0.0 ); vec2 barkGx = vec2( 0.0 ); vec2 barkGy = vec2( 0.0 );
#ifdef USE_MAP
  { float col = floor( vMapUv.x / 16.0 );
    vec2 buv = vec2( vMapUv.x - col * 16.0, vMapUv.y );
    barkAuv = vec2( ( col + fract( buv.x ) ) * 0.25, buv.y );
    barkGx = dFdx( buv ) * vec2( 0.25, 1.0 ); barkGy = dFdy( buv ) * vec2( 0.25, 1.0 ); }
  vec4 sampledDiffuseColor = textureGrad( map, barkAuv, barkGx, barkGy );
  diffuseColor *= sampledDiffuseColor;
#endif`);
      fs = fs.replace('#include <normal_fragment_maps>', /* glsl */ `
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 mapN = textureGrad( normalMap, barkAuv, barkGx, barkGy ).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale;
  normal = normalize( tbn * mapN );
#else
  #include <normal_fragment_maps>
#endif`);
    }
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  const key = `veg_${o.wind ? 1 : 0}${o.fade ? 1 : 0}${o.leaf ? 1 : 0}${o.barkAtlas ? 1 : 0}_${trans}`;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}|${key}`;
}

/** normal_fragment_begin without the back-face flip (leaf cards carry outward canopy normals). */
function ShaderChunkNoFlip(): string {
  return THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
}
