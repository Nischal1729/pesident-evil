import * as THREE from 'three';
import { worldUniforms } from './materials';

/**
 * Physically based sky + sun/moon lighting + time of day. `t` 0 = golden hour (≈17:30), 1 = night.
 *
 * Atmosphere: Hillaire-style LUTs (transmittance → multiple scattering → sky-view), rendered on the GPU. The static
 * LUTs are made once; the sky-view LUT is re-rendered whenever the sun moves. The dome samples the sky-view LUT and
 * adds the sun disc, a raymarched cumulus layer (flat bases, domed tops, sunlit edges, drifting with the wind),
 * a thin cirrus layer, stars, a phased moon, and the orange sodium/LED skyglow of Bengaluru at night.
 * The same dome material renders into the PMREM environment, so reflections carry the sky and clouds.
 * Scene lighting (sun/hemisphere colours and intensities, exposure) keeps the hand-tuned keyframes; the fog colour
 * follows the rendered horizon so distant buildings melt into the actual sky.
 */
interface Keyframe {
  t: number;
  sunElev: number; // degrees
  sunAz: number; // degrees from north, clockwise (west = 270)
  sunColor: [number, number, number];
  sunI: number;
  hemiSky: [number, number, number];
  hemiGround: [number, number, number];
  hemiI: number;
  fog: [number, number, number];
  fogD: number;
  night: number;
  exposure: number;
  /** cumulus coverage 0..1 */
  clouds: number;
  /** aerosol (Mie) multiplier: Bengaluru is hazy, more so towards evening */
  haze: number;
}

const KEYS: Keyframe[] = [
  { t: 0.0, sunElev: 34, sunAz: 272, sunColor: [1.0, 0.9, 0.76], sunI: 4.3, hemiSky: [0.7, 0.72, 0.78], hemiGround: [0.5, 0.42, 0.33], hemiI: 1.45, fog: [0.68, 0.75, 0.85], fogD: 0.001, night: 0, exposure: 1.0, clouds: 0.42, haze: 2.0 },
  { t: 0.3, sunElev: 17, sunAz: 280, sunColor: [1.0, 0.74, 0.48], sunI: 3.6, hemiSky: [0.58, 0.58, 0.72], hemiGround: [0.42, 0.32, 0.24], hemiI: 1.0, fog: [0.74, 0.66, 0.6], fogD: 0.0012, night: 0.1, exposure: 1.05, clouds: 0.46, haze: 2.3 },
  { t: 0.5, sunElev: 5, sunAz: 285, sunColor: [1.0, 0.5, 0.26], sunI: 2.2, hemiSky: [0.38, 0.38, 0.58], hemiGround: [0.26, 0.2, 0.18], hemiI: 0.7, fog: [0.5, 0.38, 0.4], fogD: 0.0017, night: 0.35, exposure: 1.12, clouds: 0.5, haze: 2.6 },
  { t: 0.7, sunElev: -5, sunAz: 290, sunColor: [0.55, 0.62, 1.0], sunI: 0.35, hemiSky: [0.25, 0.3, 0.5], hemiGround: [0.12, 0.1, 0.12], hemiI: 0.55, fog: [0.14, 0.14, 0.2], fogD: 0.0024, night: 0.75, exposure: 1.2, clouds: 0.5, haze: 2.6 },
  { t: 1.0, sunElev: -20, sunAz: 300, sunColor: [0.55, 0.65, 1.0], sunI: 0.42, hemiSky: [0.18, 0.24, 0.42], hemiGround: [0.06, 0.06, 0.08], hemiI: 0.5, fog: [0.035, 0.04, 0.07], fogD: 0.0030, night: 1, exposure: 1.3, clouds: 0.45, haze: 2.3 },
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
    hemiSky: L3(a.hemiSky, b.hemiSky), hemiGround: L3(a.hemiGround, b.hemiGround), hemiI: L(a.hemiI, b.hemiI),
    fog: L3(a.fog, b.fog), fogD: L(a.fogD, b.fogD), night: L(a.night, b.night), exposure: L(a.exposure, b.exposure),
    clouds: L(a.clouds, b.clouds), haze: L(a.haze, b.haze),
  };
}

// ------------------------------------------------------------------------------------------------ GLSL
const TRANS_W = 256, TRANS_H = 64, MS_SIZE = 32, VIEW_W = 192, VIEW_H = 108;

/** Atmosphere model shared by all passes. Distances in km, Earth-centred frame, +Y up. */
const ATMO = /* glsl */ `
#define PI 3.14159265359
const float R_GROUND = 6360.0;
const float R_TOP = 6460.0;
const float GROUND_ALT = 0.9;            // Bengaluru sits ~900 m above sea level
const vec3 RAY_SCAT = vec3(5.802, 13.558, 33.1) * 1e-3;
const float RAY_H = 8.0;
const float MIE_SCAT = 3.996e-3;
const float MIE_ABS = 4.40e-3;
const float MIE_H = 1.2;
const vec3 OZONE_ABS = vec3(0.650, 1.881, 0.085) * 1e-3;
const vec3 GROUND_ALBEDO = vec3(0.3, 0.25, 0.2);
uniform float uHaze;

void medium(float h, out vec3 scatR, out float scatM, out vec3 ext) {
  float dR = exp(-h / RAY_H);
  float dM = exp(-h / MIE_H);
  float dO = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  scatR = RAY_SCAT * dR;
  scatM = MIE_SCAT * uHaze * dM;
  ext = scatR + vec3(scatM + MIE_ABS * uHaze * dM) + OZONE_ABS * dO;
}

/** Distance to the sphere of radius r along the ray (nearest positive hit), −1 if none. */
float raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return -1.0;
  d = sqrt(d);
  float t0 = -b - d, t1 = -b + d;
  if (t0 > 0.0) return t0;
  if (t1 > 0.0) return t1;
  return -1.0;
}

const float H_ATM = 1132.2544; // sqrt(R_TOP² − R_GROUND²)
vec2 transmittanceUV(float r, float mu) {
  float rho = sqrt(max(r * r - R_GROUND * R_GROUND, 0.0));
  float disc = r * r * (mu * mu - 1.0) + R_TOP * R_TOP;
  float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  float dMin = R_TOP - r, dMax = rho + H_ATM;
  return vec2((d - dMin) / (dMax - dMin), rho / H_ATM);
}

/** Smooth 0..1 factor: is the sun above the geometric horizon seen from radius r? */
float earthShadow(float r, float mu) {
  float muH = -sqrt(max(0.0, 1.0 - (R_GROUND * R_GROUND) / (r * r)));
  return smoothstep(muH - 0.012, muH + 0.004, mu);
}
`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const TRANS_FRAG = /* glsl */ `
${ATMO}
varying vec2 vUv;
void main() {
  float xMu = vUv.x, xR = vUv.y;
  float rho = H_ATM * xR;
  float r = sqrt(rho * rho + R_GROUND * R_GROUND);
  float dMin = R_TOP - r, dMax = rho + H_ATM;
  float d = dMin + xMu * (dMax - dMin);
  float mu = d == 0.0 ? 1.0 : clamp((H_ATM * H_ATM - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
  vec3 ro = vec3(0.0, r, 0.0);
  vec3 rd = vec3(sqrt(max(0.0, 1.0 - mu * mu)), mu, 0.0);
  float tMax = max(raySphere(ro, rd, R_TOP), 0.0);
  float dt = tMax / 40.0;
  vec3 od = vec3(0.0);
  for (int i = 0; i < 40; i++) {
    vec3 p = ro + rd * ((float(i) + 0.5) * dt);
    vec3 sR; float sM; vec3 e;
    medium(length(p) - R_GROUND, sR, sM, e);
    od += e * dt;
  }
  gl_FragColor = vec4(exp(-od), 1.0);
}`;

const SAMPLE_TRANS = /* glsl */ `
uniform sampler2D uTrans;
vec3 transmittance(float r, float mu) { return texture2D(uTrans, transmittanceUV(r, mu)).rgb; }
`;

/** Multiple-scattering transfer LUT (Hillaire 2020, §5.5): Ψms(height, sun zenith) */
const MS_FRAG = /* glsl */ `
${ATMO}
${SAMPLE_TRANS}
varying vec2 vUv;
void main() {
  float cosSun = vUv.x * 2.0 - 1.0;
  float h = mix(0.02, R_TOP - R_GROUND - 0.02, vUv.y);
  vec3 ro = vec3(0.0, R_GROUND + h, 0.0);
  vec3 sunDir = vec3(sqrt(max(0.0, 1.0 - cosSun * cosSun)), cosSun, 0.0);
  vec3 Lsum = vec3(0.0), Fsum = vec3(0.0);
  for (int i = 0; i < 8; i++) for (int j = 0; j < 8; j++) {
    float th = 2.0 * PI * (float(i) + 0.5) / 8.0;
    float ph = acos(1.0 - 2.0 * (float(j) + 0.5) / 8.0);
    vec3 rd = vec3(sin(ph) * cos(th), cos(ph), sin(ph) * sin(th));
    float tG = raySphere(ro, rd, R_GROUND);
    float tT = raySphere(ro, rd, R_TOP);
    float tMax = tG > 0.0 ? tG : tT;
    float dt = tMax / 20.0;
    vec3 T = vec3(1.0), L = vec3(0.0), F = vec3(0.0);
    for (int k = 0; k < 20; k++) {
      vec3 p = ro + rd * ((float(k) + 0.5) * dt);
      float r = length(p);
      vec3 sR; float sM; vec3 ext;
      medium(r - R_GROUND, sR, sM, ext);
      vec3 sT = exp(-ext * dt);
      float mu = dot(p / r, sunDir);
      vec3 sun = transmittance(r, mu) * earthShadow(r, mu);
      vec3 scat = sR + vec3(sM);
      vec3 S = sun * scat * (0.25 / PI);
      L += T * (S - S * sT) / ext;
      F += T * (scat - scat * sT) / ext;
      T *= sT;
    }
    if (tG > 0.0) {
      vec3 p = ro + rd * tG;
      float mu = dot(normalize(p), sunDir);
      L += T * transmittance(R_GROUND, mu) * max(mu, 0.0) * GROUND_ALBEDO / PI;
    }
    Lsum += L; Fsum += F;
  }
  vec3 L2 = Lsum / 64.0, fms = Fsum / 64.0;
  gl_FragColor = vec4(L2 / (1.0 - fms), 1.0);
}`;

/** Sky-view LUT: in-scattered radiance for every view direction (azimuth relative to the sun × elevation). */
const VIEW_FRAG = /* glsl */ `
${ATMO}
${SAMPLE_TRANS}
uniform sampler2D uMS;
uniform float uSunElev;
uniform float uCamAlt;
varying vec2 vUv;
vec3 msAt(float r, float mu) { return texture2D(uMS, vec2(mu * 0.5 + 0.5, (r - R_GROUND) / (R_TOP - R_GROUND))).rgb; }
void main() {
  float az = vUv.x * vUv.x * PI;
  float a = abs(vUv.y - 0.5) * 2.0;
  float elev = sign(vUv.y - 0.5) * a * a * PI * 0.5;
  vec3 rd = vec3(cos(elev) * cos(az), sin(elev), cos(elev) * sin(az));
  vec3 sunDir = vec3(cos(uSunElev), sin(uSunElev), 0.0);
  vec3 ro = vec3(0.0, R_GROUND + uCamAlt, 0.0);
  float tG = raySphere(ro, rd, R_GROUND);
  float tT = raySphere(ro, rd, R_TOP);
  float tMax = tG > 0.0 ? tG : tT;
  float c = dot(rd, sunDir);
  float phR = 3.0 / (16.0 * PI) * (1.0 + c * c);
  const float g = 0.8;
  float phM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + c * c)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * c, 1.5));
  vec3 T = vec3(1.0), L = vec3(0.0);
  float tPrev = 0.0;
  const int N = 32;
  for (int i = 0; i < N; i++) {
    float f = (float(i) + 1.0) / float(N);
    float t = tMax * f * f;          // denser samples near the camera
    float dt = t - tPrev;
    float ts = tPrev + dt * 0.5;
    tPrev = t;
    vec3 p = ro + rd * ts;
    float r = length(p);
    vec3 sR; float sM; vec3 ext;
    medium(r - R_GROUND, sR, sM, ext);
    vec3 sT = exp(-ext * dt);
    float mu = dot(p / r, sunDir);
    vec3 sun = transmittance(r, mu) * earthShadow(r, mu);
    vec3 ms = msAt(r, mu);
    vec3 S = sR * (phR * sun + ms) + sM * (phM * sun + ms);
    L += T * (S - S * sT) / ext;
    T *= sT;
  }
  gl_FragColor = vec4(L, 1.0);
}`;

/** Tileable cloud noise: R = fbm (base shapes), G = inverted Worley fbm (billows), B = detail fbm, A = cirrus streaks. */
const NOISE_FRAG = /* glsl */ `
varying vec2 vUv;
vec2 grad(vec2 i) { float h = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453) * 6.2831853; return vec2(cos(h), sin(h)); }
float pnoise(vec2 p, vec2 per) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 i0 = mod(i, per), i1 = mod(i + 1.0, per);
  float a = dot(grad(i0), f);
  float b = dot(grad(vec2(i1.x, i0.y)), f - vec2(1.0, 0.0));
  float c = dot(grad(vec2(i0.x, i1.y)), f - vec2(0.0, 1.0));
  float d = dot(grad(i1), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float pfbm(vec2 p, vec2 per, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * pnoise(p, per); n += a; p *= 2.0; per *= 2.0; a *= 0.5; }
  return s / n;
}
float pworley(vec2 p, vec2 per) {
  vec2 i = floor(p), f = fract(p);
  float md = 1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 c = mod(i + o, per);
    vec2 h = fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453);
    vec2 r = o + h - f;
    md = min(md, dot(r, r));
  }
  return sqrt(md);
}
void main() {
  vec2 uv = vUv;
  float R = clamp(pfbm(uv * 4.0, vec2(4.0), 7) * 1.1 + 0.5, 0.0, 1.0);
  float w = pworley(uv * 6.0, vec2(6.0)) * 0.6 + pworley(uv * 12.0, vec2(12.0)) * 0.28 + pworley(uv * 24.0, vec2(24.0)) * 0.12;
  float G = clamp(1.0 - w * 1.25, 0.0, 1.0);
  float B = clamp(pfbm(uv * 16.0, vec2(16.0), 4) * 1.1 + 0.5, 0.0, 1.0);
  float A = clamp(pfbm(vec2(uv.x * 3.0, uv.y * 16.0), vec2(3.0, 16.0), 5) * 1.3 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(R, G, B, A);
}`;

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const LOWRES_VERT = /* glsl */ `
varying vec2 vNdc;
varying vec3 vDir;
void main() { vNdc = position.xy; vDir = vec3(0.0); gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DOME_FRAG = /* glsl */ `
${ATMO}
${SAMPLE_TRANS}
uniform sampler2D uView;
uniform sampler2D uNoise;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uLightDir;      // cloud self-shadowing direction (sun, or the moon at night)
uniform vec3 uMoonLight;     // moonlight colour × intensity reaching the clouds
uniform vec3 uGlow;          // city skyglow colour × intensity
uniform vec3 uFogCol;
uniform vec3 uCamKm;         // camera x, altitude above ground, z (km)
uniform float uSkyScale;
uniform float uSunDisc;
uniform float uCloudSun;
uniform float uNight;
uniform float uTime;
uniform float uCoverage;
uniform float uStars;
uniform float uAdapt;        // eye adaptation: brightens the (physically dim) twilight sky
varying vec3 vDir;

#ifndef CLOUD_STEPS
#define CLOUD_STEPS 6
#endif
const float SKY_KNEE = 0.45, SKY_SOFT = 0.6;
const float CL_BOT = 1.5, CL_TOP = 3.2;      // cumulus layer, km above the ground
const float CIRRUS = 8.0;
const vec2 WIND = vec2(0.016, 0.006);        // km/s

/** Soft luminance compression for the sky only: keeps the deep zenith blue, tames the (physically) very bright hazy horizon. */
vec3 skyCompress(vec3 c) {
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return c / (1.0 + max(0.0, L - SKY_KNEE) * SKY_SOFT);
}

vec3 skyLut(vec3 d) {
  float elev = asin(clamp(d.y, -1.0, 1.0));
  float daz = abs(atan(d.z, d.x) - atan(uSunDir.z, uSunDir.x));
  if (daz > PI) daz = 2.0 * PI - daz;
  float v = 0.5 + 0.5 * sign(elev) * sqrt(abs(elev) / (PI * 0.5));
  return skyCompress(texture2D(uView, vec2(sqrt(daz / PI), v)).rgb * uSkyScale);
}

float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

float coverageAt(vec2 p) {
  vec2 q = p + WIND * uTime;
  float a = texture2D(uNoise, q * 0.055).r;
  float b = texture2D(uNoise, q * 0.15 + 0.37).g;
  float shape = a * 0.6 + b * 0.4;
  float thr = mix(0.78, 0.36, uCoverage);
  return clamp((shape - thr) / (1.0 - thr) * 1.6, 0.0, 1.0);
}

/** p = (x km, altitude above ground km, z km) */
float cloudDensity(vec3 p, bool detail) {
  float hn = (p.y - CL_BOT) / (CL_TOP - CL_BOT);
  if (hn < 0.0 || hn > 1.0) return 0.0;
  float d2 = coverageAt(p.xz);
  if (d2 <= 0.0) return 0.0;
  // cumulus towers with flat bases; the horizontal taper turns the extruded sides into soft gradients instead of walls
  float top = pow(d2, 0.5);
  float dens = smoothstep(0.0, 0.06, hn) * smoothstep(0.0, 0.3, top - hn) * (0.35 + 0.65 * d2) * smoothstep(0.0, 0.18, d2);
  if (detail && dens > 0.0) {
    // detail varies with height too (not columns), eroding the tops into billows more than the bases
    vec2 dq = (p.xz + WIND * uTime * 1.4) * 0.42 + vec2(p.y * 0.83, -p.y * 0.61);
    float det = texture2D(uNoise, dq).b * 0.65 + texture2D(uNoise, dq * 2.3 + 0.5).b * 0.35;
    float ero = det * mix(0.2, 0.32, hn);
    dens = clamp((dens - ero) / (1.0 - ero), 0.0, 1.0);
  }
  return dens;
}

vec4 cumulus(vec3 rd, float dither, vec3 sunAtCloud, vec3 ambTop, vec3 ambBot, out float dist) {
  dist = 0.0;
  if (uCoverage <= 0.01 || rd.y < 0.012) return vec4(0.0);
  float rg = R_GROUND + GROUND_ALT;
  vec3 ro = vec3(0.0, rg + uCamKm.y, 0.0);
  float t0 = raySphere(ro, rd, rg + CL_BOT);
  float t1 = raySphere(ro, rd, rg + CL_TOP);
  if (t0 < 0.0 || t0 > 55.0) return vec4(0.0);
  t1 = min(t1, t0 + 3.0);                                  // long grazing paths near the horizon: keep steps fine
  dist = t0;
  // step count follows the path length through the layer (~110 m per sample): steep rays stay cheap, grazing rays near
  // the horizon get up to 3× more samples instead of showing slices
  int nSteps = int(clamp((t1 - t0) / 0.11, float(CLOUD_STEPS), float(CLOUD_STEPS * 3)));
  float dt = (t1 - t0) / float(nSteps);
  float cosL = dot(rd, uLightDir);
  // multiple-scattering octaves (Wrenninge): each octave is less attenuated but also less forward-peaked, so thick
  // backlit clouds go grey with bright thin edges instead of glowing all over
  float ph0 = mix(hg(cosL, 0.6), hg(cosL, -0.2), 0.2) * 4.0 * PI;
  float ph1 = mix(hg(cosL, 0.3), hg(cosL, -0.1), 0.2) * 4.0 * PI;
  float ph2 = hg(cosL, 0.15) * 4.0 * PI;
  float cosM = dot(rd, uMoonDir);
  float phaseM = hg(cosM, 0.3) * 4.0 * PI;
  float T = 1.0;
  vec3 L = vec3(0.0);
  const float SIGMA = 18.0;                               // extinction per km at density 1
  const float SIGMA_L = 6.0;                              // effective extinction towards the light (multiple scattering)
  for (int i = 0; i < CLOUD_STEPS * 3; i++) {
    if (i >= nSteps) break;
    float t = t0 + dt * (float(i) + dither);
    vec3 pw = ro + rd * t;
    float alt = length(pw) - rg;
    vec3 p = vec3(pw.x + uCamKm.x, alt, pw.z + uCamKm.z);
    float dens = cloudDensity(p, true);
    if (dens < 0.004) continue;
    float sigma = dens * SIGMA;
    // light: two taps towards the light source (cheap shape-only density)
    float tl = cloudDensity(p + uLightDir * 0.18, false) * 0.18 + cloudDensity(p + uLightDir * 0.6, false) * 0.5;
    float tauL = tl * SIGMA_L;
    float lightS = (exp(-tauL) * ph0 + 0.5 * exp(-tauL * 0.5) * ph1 + 0.25 * exp(-tauL * 0.25) * ph2) * 0.62;
    float powder = 1.0 - exp(-sigma * 0.12);
    float hn = clamp((alt - CL_BOT) / (CL_TOP - CL_BOT), 0.0, 1.0);
    vec3 amb = mix(ambBot, ambTop, smoothstep(0.0, 1.0, hn));
    vec3 S = (sunAtCloud * lightS + uMoonLight * phaseM * exp(-tauL * 0.4)) * mix(0.6, 1.0, powder) + amb;
    float sT = exp(-sigma * dt);
    L += T * S * (1.0 - sT);
    T *= sT;
    if (T < 0.03) break;
  }
  return vec4(L, 1.0 - T);
}

float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

/** One star per sky cell at most, kept inside the cell's middle so a single cell lookup is exact (no neighbours). */
vec3 stars(vec3 d) {
  float px = max(length(fwidth(d)), 1e-4);
  const float scale = 150.0;
  vec3 c = floor(d * scale);
  vec3 h = hash33(c);
  if (h.x > 0.012) return vec3(0.0);
  vec3 sd = normalize(c + 0.25 + 0.5 * hash33(c + 17.0));
  float mag = pow(h.y, 14.0);
  float rad = px * 0.85;
  float dd = length(d - sd);
  float tw = 0.75 + 0.25 * sin(uTime * (2.0 + h.z * 5.0) + h.z * 40.0);
  vec3 tint = mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.86, 0.66), h.z);
  return tint * mag * tw * exp(-dd * dd / (rad * rad)) * 7.0;
}

vec3 moon(vec3 d) {
  vec3 m = uMoonDir;
  float cd = dot(d, m);
  if (cd < 0.9) return vec3(0.0);
  float rad = 0.0072;                                     // a bit larger than life (0.26°) so it reads on screen
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), m));
  vec3 up = cross(m, right);
  vec2 q = vec2(dot(d - m, right), dot(d - m, up)) / rad;
  float r2 = dot(q, q);
  vec3 col = vec3(0.0);
  if (r2 < 1.0) {
    vec3 n = vec3(q, sqrt(1.0 - r2));
    vec3 Lm = normalize(vec3(-0.55, 0.25, 0.8));           // waxing gibbous
    float lit = smoothstep(-0.05, 0.12, dot(n, Lm));
    float maria = texture2D(uNoise, q * 0.16 + 0.61).r;
    float alb = mix(0.95, 0.55, smoothstep(0.45, 0.62, maria));
    col = vec3(1.0, 0.97, 0.9) * lit * alb * 3.2 * smoothstep(1.0, 0.92, r2);
  }
  col += vec3(0.6, 0.7, 0.9) * (pow(cd, 1800.0) * 0.35 + pow(cd, 90.0) * 0.035);
  return col;
}

/** Air + night glow for direction d (no clouds, no sun/stars/moon). */
vec3 airColor(vec3 d) {
  // below the horizon, keep the horizon colour (the LUT there is the dark in-scatter towards the ground)
  vec3 sky = skyLut(vec3(d.x, max(d.y, 0.0), d.z)) * uAdapt;
  // Bengaluru at night: moonlit blue up high, orange sodium/LED skyglow near the horizon (strongest over the city, north)
  float e = max(d.y, 0.0);
  vec3 nightSky = vec3(0.0026, 0.0036, 0.0068) * (0.5 + 0.5 * clamp(uMoonDir.y * 2.0, 0.0, 1.0));
  vec3 glow = uGlow * (exp(-e * 9.0) * 0.8 + exp(-e * 2.5) * 0.2) * (0.65 + 0.35 * max(0.0, -d.z));
  sky += (nightSky + glow) * uNight;
  // below the horizon: blend into the fog colour so distant geometry meets the sky cleanly
  return mix(sky, uFogCol, smoothstep(0.0, -0.04, d.y));
}

/** The expensive part: air + cirrus + cumulus. rgb = radiance, a = transmittance left for the sun/stars/moon behind. */
vec4 skyBase(vec3 d, vec2 fragCoord) {
  vec3 sky = airColor(d);
  vec3 ro = vec3(0.0, R_GROUND + GROUND_ALT + uCamKm.y, 0.0);
  float rC = R_GROUND + GROUND_ALT + 2.0;
  vec3 sunAtCloud = transmittance(rC, uSunDir.y) * earthShadow(rC, uSunDir.y) * uCloudSun;
  vec3 zen = texture2D(uView, vec2(0.5, 0.995)).rgb * uSkyScale * uAdapt;
  vec3 skyAvg = mix(zen, uFogCol, 0.55);                  // clouds see the whole (mostly pale) sky, not just the zenith
  vec3 nightSky = vec3(0.0026, 0.0036, 0.0068);
  vec3 ambTop = skyAvg * 0.85 + (nightSky * 2.0 + uGlow * 0.4) * uNight;
  vec3 ambBot = skyAvg * 0.26 + sunAtCloud * max(uSunDir.y, 0.0) * 0.08 + uGlow * uNight * 1.1;

  vec3 back = sky;
  float trans = 1.0;
  // cirrus: thin, bright, streaky, far above
  if (d.y > 0.02) {
    float tc = raySphere(ro, d, R_GROUND + GROUND_ALT + CIRRUS);
    vec2 pc = (ro + d * tc).xz + uCamKm.xz + WIND * uTime * 2.2;
    float cmask = smoothstep(0.45, 0.7, texture2D(uNoise, pc * 0.004 + 0.8).r);
    if (cmask > 0.0) {
      float s = texture2D(uNoise, vec2(pc.x * 0.035 + pc.y * 0.012, pc.y * 0.05 - pc.x * 0.01)).a;
      float s2 = texture2D(uNoise, pc * 0.09 + 0.3).b;
      float ci = smoothstep(0.62, 0.92, s * (0.75 + 0.5 * s2)) * 0.1 * cmask * smoothstep(0.03, 0.3, d.y) * (0.4 + uCoverage);
      vec3 ciCol = sunAtCloud * (hg(dot(d, uSunDir), 0.55) * 4.0 * PI * 0.6 + 0.35) + ambTop * 0.8;
      back = mix(back, ciCol, ci);
      trans *= 1.0 - ci;
    }
  }
  // white-noise jitter (no directional structure, so the upsample turns it into soft grain rather than streaks)
  float dither = hash13(vec3(fragCoord, 17.0));
  float dist;
  // full per-pixel jitter of the march start: removes slice banding; the half-res upsample smooths the residue
  vec4 cl = cumulus(d, dither, sunAtCloud, ambTop, ambBot, dist);
  // aerial perspective: distant clouds dissolve into the haze
  float haze = 1.0 - exp(-dist / 16.0);
  vec3 clCol = mix(cl.rgb, sky * cl.a, haze * 0.92);
  float farFade = 1.0 - smoothstep(30.0, 55.0, dist);   // the farthest clouds dissolve completely into the horizon haze
  cl *= farFade; clCol *= farFade;
  return vec4(back * (1.0 - cl.a) + clCol, trans * (1.0 - cl.a));
}

/** Cheap, sharp extras drawn at full resolution: sun disc, stars, moon. */
vec3 skyExtras(vec3 d, vec3 air) {
  vec3 ro = vec3(0.0, R_GROUND + GROUND_ALT + uCamKm.y, 0.0);
  float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
  const float SUN_R = 0.0058;
  vec3 ex = vec3(0.0);
  if (ang < SUN_R * 1.2) {
    float x = clamp(ang / SUN_R, 0.0, 1.0);
    float limb = 1.0 - 0.55 * (1.0 - sqrt(max(0.0, 1.0 - x * x)));
    ex += transmittance(ro.y, d.y) * uSunDisc * limb * smoothstep(1.2, 0.95, ang / SUN_R);
  }
  if (uNight > 0.02) {
    float skyL = dot(air, vec3(0.2126, 0.7152, 0.0722));
    ex += (stars(d) * uStars * smoothstep(0.08, 0.45, d.y) * smoothstep(0.05, 0.006, skyL) + moon(d)) * uNight;
  }
  return ex;
}

#if SKY_MODE == 1
// low-resolution pass: full-screen quad, direction reconstructed from the camera
varying vec2 vNdc;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
void main() {
  vec4 v = uProjInv * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(mat3(uCamWorld) * (v.xyz / v.w));
  gl_FragColor = skyBase(d, gl_FragCoord.xy);
}
#else
uniform sampler2D uLowTex;
uniform vec2 uInvRes;
uniform float uLowRes;
void main() {
  vec3 d = normalize(vDir);
  vec4 base;
  vec3 air;
  if (uLowRes > 0.5) {
    base = texture2D(uLowTex, gl_FragCoord.xy * uInvRes);
    air = base.rgb;
  } else {
    base = skyBase(d, gl_FragCoord.xy);
    air = airColor(d);
  }
  gl_FragColor = vec4(base.rgb + skyExtras(d, air) * base.a, 1.0);
}
#endif
`;

// ------------------------------------------------------------------------------------------------ Sky
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
  // atmosphere LUTs
  private transRT: THREE.WebGLRenderTarget;
  private msRT: THREE.WebGLRenderTarget;
  private viewRT: THREE.WebGLRenderTarget;
  private noiseRT: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private viewMat: THREE.ShaderMaterial;
  private atmoUniforms = { uHaze: { value: 2.0 } };
  private horizonFog = new THREE.Color(0.7, 0.76, 0.86);
  private horizonOk = false;
  private readBuf = new Uint16Array(VIEW_W * 4);
  private envGroundMat = new THREE.MeshBasicMaterial({ color: 0x3a3028 });
  private envSkylineMat = new THREE.MeshBasicMaterial({ color: 0x20242a, vertexColors: true });
  private envTreeMat = new THREE.MeshBasicMaterial({ color: 0x1c2a18 });
  // half-resolution sky (air + clouds), re-rendered every frame in prepare(); the dome upsamples it
  private lowRT: THREE.WebGLRenderTarget;
  private lowMat: THREE.ShaderMaterial;
  private lowScale: number;
  private drawSize = new THREE.Vector2();

  /**
   * @param cloudSteps cumulus raymarch steps (quality)
   * @param lowResScale resolution of the per-frame sky pass relative to the drawing buffer (clouds are soft, 0.5 is plenty)
   */
  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, shadowMapSize: number, shadowDistance: number, cloudSteps = 6, lowResScale = 0.5) {
    this.lowScale = lowResScale;
    const rtOpts = (w: number, h: number, type: THREE.TextureDataType = THREE.HalfFloatType) => new THREE.WebGLRenderTarget(w, h, {
      type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    this.transRT = rtOpts(TRANS_W, TRANS_H);
    this.msRT = rtOpts(MS_SIZE, MS_SIZE);
    this.viewRT = rtOpts(VIEW_W, VIEW_H);
    this.noiseRT = new THREE.WebGLRenderTarget(512, 512, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, generateMipmaps: true, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, anisotropy: 8,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    // static LUTs + noise, once
    this.runPass(new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: NOISE_FRAG }), this.noiseRT);
    this.runPass(new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: TRANS_FRAG, uniforms: { ...this.atmoUniforms } }), this.transRT);
    this.runPass(this.msMaterial(), this.msRT);
    this.viewMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: VIEW_FRAG,
      uniforms: { ...this.atmoUniforms, uTrans: { value: this.transRT.texture }, uMS: { value: this.msRT.texture }, uSunElev: { value: 0.5 }, uCamAlt: { value: 0.03 } },
    });

    this.uniforms = {
      ...this.atmoUniforms,
      uTrans: { value: this.transRT.texture },
      uView: { value: this.viewRT.texture },
      uNoise: { value: this.noiseRT.texture },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0.3, 0.62, 0.5).normalize() },
      uLightDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonLight: { value: new THREE.Color(0, 0, 0) },
      uGlow: { value: new THREE.Color(0.075, 0.042, 0.02) },
      uFogCol: { value: new THREE.Color() },
      uCamKm: { value: new THREE.Vector3(0, 0.002, 0) },
      uSkyScale: { value: 26 },
      uSunDisc: { value: 60 },
      uCloudSun: { value: 1.35 },
      uNight: { value: 0 },
      uTime: worldUniforms.uTime,
      uCoverage: { value: 0.42 },
      uStars: { value: 1 },
      uAdapt: { value: 1 },
    };
    const steps = Math.max(2, Math.round(cloudSteps));
    this.lowRT = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false,
    });
    Object.assign(this.uniforms, { uLowTex: { value: this.lowRT.texture }, uInvRes: { value: new THREE.Vector2(1, 1) }, uLowRes: { value: 0 } });
    // dome: upsamples the low-res pass and adds the sharp sun/stars/moon (falls back to the full sky if prepare() isn't called)
    const mat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
      defines: { CLOUD_STEPS: steps, SKY_MODE: 2 },
    });
    // environment capture renders the full sky; it's blurred into the PMREM, so 4 cloud steps look identical and
    // keep the occasional env rebuild (time-of-day changes) from hitching
    const envMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, uniforms: { ...this.uniforms, uLowRes: { value: 0 } }, side: THREE.BackSide, depthWrite: false, fog: false,
      defines: { CLOUD_STEPS: Math.min(steps, 4), SKY_MODE: 2 },
    });
    this.lowMat = new THREE.ShaderMaterial({
      vertexShader: LOWRES_VERT, fragmentShader: DOME_FRAG, depthTest: false, depthWrite: false,
      uniforms: { ...this.uniforms, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() } },
      defines: { CLOUD_STEPS: steps, SKY_MODE: 1 },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.mesh.frustumCulled = false;
    // drawn last among opaques: the depth test (sky at the far plane) skips every pixel covered by geometry
    this.mesh.renderOrder = 1e6;
    this.mesh.name = 'sky';
    scene.add(this.mesh);
    this.envMesh = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), envMat);
    this.envScene.add(this.envMesh);
    // env ground (lit like the ground at this time of day) + a skyline ring of building / tree silhouettes, so
    // glass, granite and puddles reflect a horizon rather than bare sky
    const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 24).rotateX(-Math.PI / 2), this.envGroundMat);
    ground.position.y = -2;
    this.envScene.add(ground);
    this.envScene.add(this.skylineRing());

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

  private msMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: MS_FRAG, uniforms: { ...this.atmoUniforms, uTrans: { value: this.transRT.texture } } });
  }

  private runPass(mat: THREE.Material, target: THREE.WebGLRenderTarget): void {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevAuto = r.autoClear;
    this.quad.material = mat;
    r.autoClear = true;
    r.setRenderTarget(target);
    r.render(this.quadScene, this.quadCam);
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
  }

  setShadowDistance(d: number): void {
    this.shadowDistance = d;
    const cam = this.sun.shadow.camera;
    cam.left = -d / 2; cam.right = d / 2; cam.top = d / 2; cam.bottom = -d / 2;
    cam.near = 1; cam.far = 400;
    cam.updateProjectionMatrix();
  }

  /** Cumulus coverage override (0..1), e.g. for weather; null returns to the time-of-day default. */
  cloudOverride: number | null = null;
  /** Moving cloud shadows on the ground (materials sample the cumulus field toward the sun). */
  cloudShadows = true;
  private lightDirRaw = new THREE.Vector3();
  /** Aerosol override (debug / weather); null = time-of-day default. */
  hazeOverride: number | null = null;

  setTime(t: number): void {
    const k = (this.key = lerpKey(t));
    const el = THREE.MathUtils.degToRad(k.sunElev);
    const az = THREE.MathUtils.degToRad(k.sunAz);
    // azimuth from north (−Z) clockwise toward east (+X)
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uNight.value = k.night;
    this.uniforms.uCoverage.value = this.cloudOverride ?? k.clouds;
    // cloud shadows on the ground follow the same cumulus field (materials.ts wlCloudShadow)
    worldUniforms.uCloudTex.value = this.noiseRT.texture;
    worldUniforms.uCloudCov.value = this.uniforms.uCoverage.value as number;
    worldUniforms.uCloudOn.value = this.cloudShadows ? 1 : 0;
    worldUniforms.uNight.value = k.night;

    // atmosphere: haze changes rebuild the static LUTs (rare); the sky-view LUT follows the sun
    const haze = this.hazeOverride ?? k.haze;
    if (Math.abs(this.atmoUniforms.uHaze.value - haze) > 0.05) {
      this.atmoUniforms.uHaze.value = haze;
      this.runPass(new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: TRANS_FRAG, uniforms: { ...this.atmoUniforms } }), this.transRT);
      this.runPass(this.msMaterial(), this.msRT);
    }
    this.viewMat.uniforms.uSunElev.value = el;
    // eye adaptation through twilight: ×1 by day, up to ×28 once the sun is well below the horizon
    this.uniforms.uAdapt.value = THREE.MathUtils.lerp(1, 28, THREE.MathUtils.smoothstep(-k.sunElev, -2, 9));
    this.runPass(this.viewMat, this.viewRT);
    this.readHorizon();

    // light: sun above horizon, otherwise moonlight from the moon direction
    const moon = this.uniforms.uMoonDir.value as THREE.Vector3;
    const sunUp = THREE.MathUtils.smoothstep(k.sunElev, -3, 3);
    const lightDir = new THREE.Vector3().copy(this.sunDir).multiplyScalar(sunUp).addScaledVector(moon, 1 - sunUp).normalize();
    // clouds are self-shadowed toward whichever body lights them (the sun still lights them a few degrees below the horizon)
    (this.uniforms.uLightDir.value as THREE.Vector3).copy(k.sunElev > -4 ? this.sunDir : moon);
    worldUniforms.uCloudDir.value.copy(this.lightDirRaw.copy(this.sunDir).multiplyScalar(sunUp).addScaledVector(moon, 1 - sunUp).normalize());
    (this.uniforms.uMoonLight.value as THREE.Color).setRGB(0.02, 0.024, 0.03).multiplyScalar(THREE.MathUtils.smoothstep(k.night, 0.5, 1));
    if (lightDir.y < 0.12) lightDir.y = 0.12;
    lightDir.normalize();
    this.lightDir.copy(lightDir);
    this.sun.color.setRGB(...k.sunColor);
    this.sun.intensity = k.sunI;
    this.hemi.color.setRGB(...k.hemiSky);
    this.hemi.groundColor.setRGB(...k.hemiGround);
    this.hemi.intensity = k.hemiI;
    // fog: the rendered horizon by day (so buildings fade into the real sky), the tuned keyframe colour at night
    const kf = new THREE.Color().setRGB(...k.fog);
    if (this.horizonOk) kf.lerp(this.horizonFog, 0.7 * (1 - THREE.MathUtils.smoothstep(k.night, 0.3, 0.8)));
    this.fog.color.copy(kf);
    (this.uniforms.uFogCol.value as THREE.Color).copy(kf);
    this.fog.density = k.fogD;
    this.exposure = k.exposure;
    // env ground + skyline lit like the scene at this time of day (dim silhouettes against the sky)
    const amb = new THREE.Color().setRGB(...k.hemiGround).multiplyScalar(k.hemiI);
    this.envGroundMat.color.copy(amb).multiplyScalar(0.12);
    this.envSkylineMat.color.copy(amb).lerp(new THREE.Color().setRGB(...k.hemiSky).multiplyScalar(k.hemiI), 0.5).multiplyScalar(0.16);
    this.envTreeMat.color.setRGB(0.06, 0.09, 0.05).multiplyScalar(k.hemiI);
    if (Math.abs(t - this.lastEnvT) > 0.04) this.updateEnv(t);
  }

  lightDir = new THREE.Vector3(0, 1, 0);

  /** Average sky radiance just above the horizon (the fog colour). One tiny synchronous read per sun move. */
  private readHorizon(): void {
    try {
      const v = 0.5 + 0.5 * Math.sqrt(2 / 90);
      const row = Math.min(VIEW_H - 1, Math.floor(v * VIEW_H));
      this.renderer.readRenderTargetPixels(this.viewRT, 0, row, VIEW_W, 1, this.readBuf);
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < VIEW_W; i++) {
        r += THREE.DataUtils.fromHalfFloat(this.readBuf[i * 4]);
        g += THREE.DataUtils.fromHalfFloat(this.readBuf[i * 4 + 1]);
        b += THREE.DataUtils.fromHalfFloat(this.readBuf[i * 4 + 2]);
      }
      const s = (this.uniforms.uSkyScale.value as number) * (this.uniforms.uAdapt.value as number) / VIEW_W;
      if (Number.isFinite(r + g + b)) {
        r *= s; g *= s; b *= s;
        const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const c = 1 / (1 + Math.max(0, L - 0.45) * 0.6); // = skyCompress() in the dome shader
        this.horizonFog.setRGB(r * c, g * c, b * c);
        this.horizonOk = true;
      }
    } catch {
      this.horizonOk = false;
    }
  }

  private updateEnv(t: number): void {
    this.lastEnvT = t;
    const rt = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 500);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.6, 0.3, this.key.night);
  }

  /** Low ring of box buildings and blob trees around the env capture point (angular heights ≈ 2–14°). */
  private skylineRing(): THREE.Group {
    const g = new THREE.Group();
    const boxes: THREE.BufferGeometry[] = [];
    const trees: THREE.BufferGeometry[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const R = 70;
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2 + rnd() * 0.05;
      const w = 6 + rnd() * 10, h = 3 + rnd() * rnd() * 16, d = 6;
      const b = new THREE.BoxGeometry(w, h, d);
      b.translate(0, h / 2 - 2, 0).rotateY(-a).translate(Math.cos(a) * R, 0, Math.sin(a) * R);
      const shade = 0.75 + rnd() * 0.5;
      const cols = new Float32Array(b.attributes.position.count * 3).fill(shade);
      b.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      boxes.push(b);
      if (rnd() < 0.6) {
        const t = new THREE.IcosahedronGeometry(3 + rnd() * 3, 1);
        const ta = a + 0.04;
        t.scale(1, 0.8, 1).translate(Math.cos(ta) * (R - 8), 2 + rnd() * 3, Math.sin(ta) * (R - 8));
        trees.push(t);
      }
    }
    const merge = (list: THREE.BufferGeometry[], attrs: string[]): THREE.BufferGeometry => {
      const out = new THREE.BufferGeometry();
      for (const name of attrs) {
        const parts = list.map((geo) => (geo.index ? geo.toNonIndexed() : geo).attributes[name].array as Float32Array);
        const total = parts.reduce((n, p) => n + p.length, 0);
        const arr = new Float32Array(total);
        let o = 0;
        for (const p of parts) { arr.set(p, o); o += p.length; }
        out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
      }
      return out;
    };
    g.add(new THREE.Mesh(merge(boxes, ['position', 'color']), this.envSkylineMat));
    g.add(new THREE.Mesh(merge(trees, ['position']), this.envTreeMat));
    return g;
  }

  /**
   * Render the expensive part of the sky (air + cirrus + cumulus) at reduced resolution for this frame's camera.
   * Call once per frame after the camera has moved, before the scene is rendered.
   */
  prepare(camera: THREE.Camera): void {
    const r = this.renderer;
    r.getDrawingBufferSize(this.drawSize);
    const w = Math.max(1, Math.round(this.drawSize.x * this.lowScale)), h = Math.max(1, Math.round(this.drawSize.y * this.lowScale));
    if (this.lowRT.width !== w || this.lowRT.height !== h) this.lowRT.setSize(w, h);
    camera.updateMatrixWorld();
    (this.lowMat.uniforms.uProjInv.value as THREE.Matrix4).copy((camera as THREE.PerspectiveCamera).projectionMatrixInverse);
    (this.lowMat.uniforms.uCamWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
    this.runPass(this.lowMat, this.lowRT);
    (this.uniforms.uInvRes.value as THREE.Vector2).set(1 / this.drawSize.x, 1 / this.drawSize.y);
    this.uniforms.uLowRes.value = 1;
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
    (this.uniforms.uCamKm.value as THREE.Vector3).set(focus.x / 1000, Math.max(0.002, focus.y / 1000), focus.z / 1000);
  }
}
