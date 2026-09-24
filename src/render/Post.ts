import * as THREE from 'three';
import {
  BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect,
  ChromaticAberrationEffect, BlendFunction, Effect,
} from 'postprocessing';

/**
 * Safe colour grade: saturation, contrast and a subtle split tone, applied after tone mapping.
 * Contrast is a power curve around linear mid-grey (0.18), so it deepens shadows without crushing them to black
 * (the old linear "(c - 0.5) * k + 0.5" clipped everything below ~0.03 linear, i.e. every shaded wall at dusk).
 * Values are clamped non-negative (the stock HueSaturationEffect produced negative channels → NaN/black).
 */
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */ `
uniform float saturation;
uniform float contrast;
uniform vec3 shadowTint;
uniform vec3 highTint;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, 0.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, 1.0 + saturation), 0.0);
  c = 0.18 * pow(c / 0.18, vec3(1.0 + contrast));
  float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(shadowTint, highTint, smoothstep(0.015, 0.45, l2));
  outputColor = vec4(c, inputColor.a);
}`, { uniforms: new Map<string, THREE.Uniform>([
      ['saturation', new THREE.Uniform(0.08)], ['contrast', new THREE.Uniform(0.05)],
      ['shadowTint', new THREE.Uniform(new THREE.Vector3(0.975, 1.0, 1.035))], ['highTint', new THREE.Uniform(new THREE.Vector3(1.02, 1.0, 0.975))],
    ]) });
  }
  set saturation(v: number) { this.uniforms.get('saturation')!.value = v; }
  set contrast(v: number) { this.uniforms.get('contrast')!.value = v; }
}
import { N8AOPostPass } from 'n8ao';
import type { QualityProfile } from '../core/Settings';

/** Post chain: N8AO (SSAO) → bloom + AGX tone mapping + grade + vignette + hit aberration + SMAA, merged into few passes. */
export class Post {
  composer: EffectComposer;
  private ao: N8AOPostPass | null = null;
  private bloom: BloomEffect | null = null;
  private vignette: VignetteEffect;
  private chroma: ChromaticAberrationEffect;
  private tone: ToneMappingEffect;
  private grade: GradeEffect;
  private hitPulse = 0;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, q: QualityProfile) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(scene, camera));
    if (q.ao) {
      this.ao = new N8AOPostPass(scene, camera, size.x, size.y);
      Object.assign(this.ao.configuration, {
        aoRadius: 1.7, distanceFalloff: 1.0, intensity: 2.2, aoSamples: q.aoHalfRes ? 12 : 16, denoiseSamples: 6, denoiseRadius: 10,
        halfRes: q.aoHalfRes, depthAwareUpsampling: true, gammaCorrection: false, screenSpaceRadius: false,
      });
      this.composer.addPass(this.ao);
    }
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.vignette = new VignetteEffect({ offset: 0.35, darkness: 0.45 });
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: true, modulationOffset: 0.2 });
    this.grade = new GradeEffect();
    const effects: any[] = [];
    if (q.bloom) {
      this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.85, luminanceSmoothing: 0.25, intensity: 0.9, radius: 0.7 });
      effects.push(this.bloom);
    }
    effects.push(this.tone, this.grade, this.vignette, this.chroma);
    this.composer.addPass(new EffectPass(camera, ...effects));
    if (q.smaa) this.composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM })));
  }

  setSize(w: number, h: number): void {
    // The composer resizes every pass (incl. N8AO) in drawing-buffer pixels. Do NOT resize N8AO again with CSS
    // pixels: a size mismatch with the depth buffer shifts the AO and leaves dark "ghost" silhouettes.
    this.composer.setSize(w, h);
  }

  setExposure(e: number): void {
    // AGX has no exposure param in postprocessing; drive renderer exposure instead
    this.renderer.toneMappingExposure = e;
  }

  /** Flash chromatic aberration / vignette when the player takes damage. */
  hit(strength: number): void {
    this.hitPulse = Math.min(1, this.hitPulse + strength);
  }

  setNight(n: number): void {
    if (this.bloom) this.bloom.intensity = 0.8 + n * 0.9;
    this.grade.saturation = 0.08 - n * 0.2;
  }

  render(dt: number, lowHealth: number): void {
    this.hitPulse = Math.max(0, this.hitPulse - dt * 2.5);
    const off = 0.0008 + this.hitPulse * 0.006 + lowHealth * 0.002;
    this.chroma.offset.set(off, off * 0.6);
    this.vignette.darkness = 0.45 + this.hitPulse * 0.3 + lowHealth * 0.3;
    this.composer.render(dt);
  }
}

export { BlendFunction };
