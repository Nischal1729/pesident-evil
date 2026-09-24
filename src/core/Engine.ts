import * as THREE from 'three';
import type { QualityProfile } from './Settings';
import { setMaterialDetail } from '../world/materials';

/** Renderer + scene + camera + resize handling. */
export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  width = 1;
  height = 1;
  onResize: ((w: number, h: number) => void) | null = null;

  constructor(public container: HTMLElement, q: QualityProfile, fov: number) {
    setMaterialDetail(q.materialDetail ?? 2); // before any world material is created
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.renderer.setPixelRatio(q.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = q.shadowMapSize > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false; // reset once per frame in the game loop so stats cover all passes
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.15, q.viewDistance);
    this.scene.add(this.camera);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize(): void {
    this.width = this.container.clientWidth || window.innerWidth;
    this.height = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.onResize?.(this.width, this.height);
  }

  setQuality(q: QualityProfile): void {
    this.renderer.setPixelRatio(q.pixelRatio);
    this.camera.far = q.viewDistance;
    this.camera.updateProjectionMatrix();
    this.resize();
  }
}
