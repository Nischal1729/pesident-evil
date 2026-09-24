import * as THREE from 'three';
import { worldUniforms } from './materials';

/**
 * Procedural sky dome + sun/moon lighting + time-of-day. `t` 0 = golden hour (≈17:30), 1 = night.
 * Also produces the PMREM environment map from the sky.
 */
interface Keyframe {
  t: number;
  sunElev: number; // degrees
  sunAz: number; // degrees from north, clockwise (west = 270)
  sunColor: [number, number, number];
  sunI: number;
  zenith: [number, number, number];
  horizon: [number, number, number];
  hemiSky: [number, number, number];
  hemiGround: [number, number, number];
  hemiI: number;
  fog: [number, number, number];
  fogD: number;
  night: number;
  exposure: number;
}

const KEYS: Keyframe[] = [
  { t: 0.0, sunElev: 34, sunAz: 272, sunColor: [1.0, 0.9, 0.76], sunI: 4.3, zenith: [0.1, 0.31, 0.82], horizon: [0.72, 0.78, 0.87], hemiSky: [0.7, 0.72, 0.78], hemiGround: [0.5, 0.42, 0.33], hemiI: 1.45, fog: [0.68, 0.75, 0.85], fogD: 0.001, night: 0, exposure: 1.0 },
  { t: 0.3, sunElev: 17, sunAz: 280, sunColor: [1.0, 0.74, 0.48], sunI: 3.6, zenith: [0.1, 0.27, 0.72], horizon: [0.96, 0.7, 0.48], hemiSky: [0.58, 0.58, 0.72], hemiGround: [0.42, 0.32, 0.24], hemiI: 1.0, fog: [0.74, 0.66, 0.6], fogD: 0.0012, night: 0.1, exposure: 1.05 },
  { t: 0.5, sunElev: 5, sunAz: 285, sunColor: [1.0, 0.5, 0.26], sunI: 2.2, zenith: [0.1, 0.15, 0.36], horizon: [0.85, 0.42, 0.3], hemiSky: [0.38, 0.38, 0.58], hemiGround: [0.26, 0.2, 0.18], hemiI: 0.7, fog: [0.5, 0.38, 0.4], fogD: 0.0017, night: 0.35, exposure: 1.12 },
  { t: 0.7, sunElev: -5, sunAz: 290, sunColor: [0.55, 0.62, 1.0], sunI: 0.35, zenith: [0.04, 0.06, 0.16], horizon: [0.28, 0.22, 0.32], hemiSky: [0.25, 0.3, 0.5], hemiGround: [0.12, 0.1, 0.12], hemiI: 0.55, fog: [0.14, 0.14, 0.2], fogD: 0.0024, night: 0.75, exposure: 1.2 },
  { t: 1.0, sunElev: -20, sunAz: 300, sunColor: [0.55, 0.65, 1.0], sunI: 0.42, zenith: [0.012, 0.02, 0.05], horizon: [0.06, 0.07, 0.12], hemiSky: [0.18, 0.24, 0.42], hemiGround: [0.06, 0.06, 0.08], hemiI: 0.5, fog: [0.035, 0.04, 0.07], fogD: 0.0030, night: 1, exposure: 1.3 },
];

function lerpKey(t: number): Keyframe {
  t = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const f = (t - a.t) / (b.t - a.t);
  const L = (x: number, y: number) => x + (y - x) * f;
  const L3 = (x: [number, number, number], y: [number, number, number]): [number, number, number] => [L(x[0], y[0]), L(x[1], y[1]), L(x[2], y[2])];
  return {
    t, sunElev: L(a.sunElev, b.sunElev), sunAz: L(a.sunAz, b.sunAz), sunColor: L3(a.sunColor, b.sunColor), sunI: L(a.sunI, b.sunI),
    zenith: L3(a.zenith, b.zenith), horizon: L3(a.horizon, b.horizon), hemiSky: L3(a.hemiSky, b.hemiSky), hemiGround: L3(a.hemiGround, b.hemiGround),
    hemiI: L(a.hemiI, b.hemiI), fog: L3(a.fog, b.fog), fogD: L(a.fogD, b.fogD), night: L(a.night, b.night), exposure: L(a.exposure, b.exposure),
  };
}

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */ `
uniform vec3 uSunDir; uniform vec3 uMoonDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunColor;
uniform float uNight; uniform float uTime; uniform float uCloud;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float hh = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(hh, 0.42));
  // horizon haze band and ground
  col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.12, h));
  float sd = max(dot(d, uSunDir), 0.0);
  float day = 1.0 - uNight;
  // warm scatter around the sun, strongest near the horizon
  col += uSunColor * (pow(sd, 6.0) * 0.35 + pow(sd, 48.0) * 0.5) * (0.4 + 0.6 * (1.0 - hh)) * max(day, 0.15);
  col += uSunColor * smoothstep(0.99955, 0.9998, sd) * 12.0 * step(-0.02, uSunDir.y);
  // clouds (cumulus-ish, projected)
  vec2 cuv = d.xz / max(h + 0.08, 0.06) * 0.55 + vec2(uTime * 0.004, uTime * 0.0015);
  float cl = fbm(cuv * 1.3);
  cl = smoothstep(0.52, 0.82, cl) * smoothstep(-0.02, 0.25, h) * uCloud;
  vec3 cloudLit = mix(uHorizon * 1.05, uSunColor * 1.2, pow(sd, 2.5) * 0.8);
  vec3 cloudCol = mix(cloudLit, uZenith * 0.8, 0.25) * mix(1.0, 0.35, uNight);
  col = mix(col, cloudCol, cl * 0.85);
  // stars + moon
  vec3 sp = floor(d * 380.0);
  float st = step(0.9982, hash(sp)) * smoothstep(0.02, 0.35, h) * (1.0 - cl);
  col += vec3(0.9, 0.95, 1.0) * st * uNight * (0.6 + 0.8 * hash(sp + 3.1));
  float md = dot(d, uMoonDir);
  col += vec3(0.85, 0.88, 1.0) * (smoothstep(0.99935, 0.9996, md) * 3.0 + pow(max(md, 0.0), 180.0) * 0.25) * uNight;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  mesh: THREE.Mesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.FogExp2;
  uniforms: Record<string, THREE.IUniform>;
  key: Keyframe = lerpKey(0);
  private envScene = new THREE.Scene();
  private envMesh: THREE.Mesh;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private lastEnvT = -1;
  sunDir = new THREE.Vector3();
  exposure = 1;
  private shadowDistance = 75;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, shadowMapSize: number, shadowDistance: number) {
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0.3, 0.6, 0.5).normalize() },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uNight: { value: 0 },
      uTime: worldUniforms.uTime,
      uCloud: { value: 0.75 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);
    this.envMesh = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat);
    this.envScene.add(this.envMesh);
    // ground bounce for the env map (red-brown earth)
    const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a3028 }));
    ground.position.y = -2;
    this.envScene.add(ground);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = shadowMapSize > 0;
    this.sun.shadow.mapSize.set(shadowMapSize || 1024, shadowMapSize || 1024);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.setShadowDistance(shadowDistance);
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);

    this.fog = new THREE.FogExp2(0x999999, 0.002);
    scene.fog = this.fog;
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  setShadowDistance(d: number): void {
    this.shadowDistance = d;
    const cam = this.sun.shadow.camera;
    cam.left = -d / 2; cam.right = d / 2; cam.top = d / 2; cam.bottom = -d / 2;
    cam.near = 1; cam.far = 400;
    cam.updateProjectionMatrix();
  }

  setTime(t: number): void {
    const k = (this.key = lerpKey(t));
    const el = THREE.MathUtils.degToRad(k.sunElev);
    const az = THREE.MathUtils.degToRad(k.sunAz);
    // azimuth from north (−Z) clockwise toward east (+X)
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.uniforms.uSunDir.value.copy(this.sunDir);
    (this.uniforms.uZenith.value as THREE.Color).setRGB(...k.zenith);
    (this.uniforms.uHorizon.value as THREE.Color).setRGB(...k.horizon);
    (this.uniforms.uSunColor.value as THREE.Color).setRGB(...k.sunColor);
    this.uniforms.uNight.value = k.night;
    worldUniforms.uNight.value = k.night;
    // light: sun above horizon, otherwise moonlight from the moon direction
    const moon = this.uniforms.uMoonDir.value as THREE.Vector3;
    const sunUp = THREE.MathUtils.smoothstep(k.sunElev, -3, 3);
    const lightDir = new THREE.Vector3().copy(this.sunDir).multiplyScalar(sunUp).addScaledVector(moon, 1 - sunUp).normalize();
    if (lightDir.y < 0.12) lightDir.y = 0.12;
    lightDir.normalize();
    this.lightDir.copy(lightDir);
    this.sun.color.setRGB(...k.sunColor);
    this.sun.intensity = k.sunI;
    this.hemi.color.setRGB(...k.hemiSky);
    this.hemi.groundColor.setRGB(...k.hemiGround);
    this.hemi.intensity = k.hemiI;
    this.fog.color.setRGB(...k.fog);
    this.fog.density = k.fogD;
    this.exposure = k.exposure;
    if (Math.abs(t - this.lastEnvT) > 0.04) this.updateEnv(t);
  }

  lightDir = new THREE.Vector3(0, 1, 0);

  private updateEnv(t: number): void {
    this.lastEnvT = t;
    const rt = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 500);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.6, 0.3, this.key.night);
  }

  /** Keep the shadow frustum centred on the focus point, snapped to texels to avoid shimmering. */
  follow(focus: THREE.Vector3): void {
    const d = this.shadowDistance;
    const texel = d / this.sun.shadow.mapSize.x;
    const dir = this.lightDir;
    // light-space snapping
    const up = Math.abs(dir.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();
    const up2 = new THREE.Vector3().crossVectors(dir, right).normalize();
    const cx = Math.round(focus.dot(right) / texel) * texel;
    const cy = Math.round(focus.dot(up2) / texel) * texel;
    const cz = focus.dot(dir);
    const center = new THREE.Vector3().addScaledVector(right, cx).addScaledVector(up2, cy).addScaledVector(dir, cz);
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(dir, 180);
    this.sun.target.updateMatrixWorld();
    this.mesh.position.set(focus.x, 0, focus.z);
  }
}
