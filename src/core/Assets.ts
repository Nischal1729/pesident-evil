import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Small caching asset loader with progress reporting. Missing files resolve to null (placeholders are used). */
export class Assets {
  private gltfLoader = new GLTFLoader();
  private texLoader = new THREE.TextureLoader();
  private gltfCache = new Map<string, Promise<GLTF | null>>();
  private texCache = new Map<string, Promise<THREE.Texture | null>>();
  private total = 0;
  private done = 0;
  onProgress: ((done: number, total: number, label: string) => void) | null = null;
  maxAnisotropy = 8;

  private track<T>(p: Promise<T>, label: string): Promise<T> {
    this.total++;
    this.onProgress?.(this.done, this.total, label);
    return p.finally(() => {
      this.done++;
      this.onProgress?.(this.done, this.total, label);
    });
  }

  gltf(url: string): Promise<GLTF | null> {
    let p = this.gltfCache.get(url);
    if (!p) {
      p = this.track(
        this.gltfLoader.loadAsync(url).catch((err) => {
          console.warn(`[assets] missing model ${url}`, err?.message ?? err);
          return null;
        }),
        url,
      );
      this.gltfCache.set(url, p);
    }
    return p;
  }

  texture(url: string, opts: { srgb?: boolean; repeat?: boolean } = {}): Promise<THREE.Texture | null> {
    const key = `${url}|${opts.srgb ? 1 : 0}|${opts.repeat === false ? 0 : 1}`;
    let p = this.texCache.get(key);
    if (!p) {
      p = this.track(
        this.texLoader.loadAsync(url).then(
          (t) => {
            t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            if (opts.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.anisotropy = this.maxAnisotropy;
            t.generateMipmaps = true;
            t.minFilter = THREE.LinearMipmapLinearFilter;
            return t;
          },
          (err) => {
            console.warn(`[assets] missing texture ${url}`, err?.message ?? err);
            return null;
          },
        ),
        url,
      );
      this.texCache.set(key, p);
    }
    return p;
  }

  /** Poly Haven style PBR set: diff.jpg, nor.jpg, arm.jpg */
  async pbr(name: string): Promise<{ map: THREE.Texture | null; normalMap: THREE.Texture | null; arm: THREE.Texture | null }> {
    const base = `${import.meta.env.BASE_URL}textures/${name}/`;
    const [map, normalMap, arm] = await Promise.all([
      this.texture(base + 'diff.jpg', { srgb: true }),
      this.texture(base + 'nor.jpg'),
      this.texture(base + 'arm.jpg'),
    ]);
    return { map, normalMap, arm };
  }
}
