export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  quality: Quality;
  sensitivity: number;
  invertY: boolean;
  fov: number;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  npcVoices: boolean;
  showFps: boolean;
}

export interface QualityProfile {
  pixelRatio: number;
  shadowMapSize: number;
  shadowDistance: number;
  ao: boolean;
  aoHalfRes: boolean;
  bloom: boolean;
  smaa: boolean;
  viewDistance: number;
  maxZombies: number;
  treeDensity: number;
  characterShadowDistance: number;
  animLodNear: number;
  dynamicLights: number;
}

export const QUALITY: Record<Quality, QualityProfile> = {
  low: { pixelRatio: 0.75, shadowMapSize: 1024, shadowDistance: 45, ao: false, aoHalfRes: true, bloom: false, smaa: false, viewDistance: 260, maxZombies: 35, treeDensity: 0.5, characterShadowDistance: 0, animLodNear: 15, dynamicLights: 2 },
  medium: { pixelRatio: 1, shadowMapSize: 2048, shadowDistance: 60, ao: true, aoHalfRes: true, bloom: true, smaa: true, viewDistance: 380, maxZombies: 50, treeDensity: 0.8, characterShadowDistance: 18, animLodNear: 25, dynamicLights: 4 },
  high: { pixelRatio: Math.min(window.devicePixelRatio, 1.5), shadowMapSize: 4096, shadowDistance: 75, ao: true, aoHalfRes: true, bloom: true, smaa: true, viewDistance: 500, maxZombies: 70, treeDensity: 1, characterShadowDistance: 30, animLodNear: 35, dynamicLights: 6 },
  ultra: { pixelRatio: Math.min(window.devicePixelRatio, 2), shadowMapSize: 4096, shadowDistance: 95, ao: true, aoHalfRes: false, bloom: true, smaa: true, viewDistance: 650, maxZombies: 90, treeDensity: 1, characterShadowDistance: 45, animLodNear: 50, dynamicLights: 8 },
};

const DEFAULTS: Settings = {
  quality: 'high',
  sensitivity: 1,
  invertY: false,
  fov: 62,
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.9,
  npcVoices: true,
  showFps: false,
};

const KEY = 'pesident-evil.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

const HS_KEY = 'pesident-evil.highscore.v1';
export interface HighScore { wave: number; kills: number; points: number }

export function loadHighScore(): HighScore | null {
  try {
    const raw = localStorage.getItem(HS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveHighScore(h: HighScore): void {
  try {
    localStorage.setItem(HS_KEY, JSON.stringify(h));
  } catch {
    /* ignore */
  }
}
