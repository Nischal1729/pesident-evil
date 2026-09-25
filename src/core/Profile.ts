import type { Profile } from '../net/protocol';

/** The player's name and character look (character screen), kept in localStorage. */
const KEY = 'pe.profile.v1';

export const SKIN_TONES = ['#f1c9a5', '#dcae88', '#c68e62', '#a36a45', '#8d5a3b', '#6b3f28', '#4a2c1c'];
export const HAIR_COLORS = ['#0e0c0b', '#2a1d14', '#4b3020', '#7a5230', '#b58a52', '#8a8a8a'];
export const SHIRT_COLORS = ['#7a1f2b', '#b3261e', '#e2701f', '#f2b233', '#3f8a4a', '#1f6f6b', '#2f5d9b', '#1d2f6f', '#5b3a8c', '#e8e6e0', '#2a2c30', '#d45d8c'];
export const PANTS_COLORS = ['#243044', '#2b3a55', '#1f2430', '#4a4f57', '#6b5a43', '#f0e6d2', '#3a3326'];
export const SHOE_COLORS = ['#f2f2f2', '#222222', '#6b4a2e', '#b3261e', '#2d59a8'];

export function defaultProfile(): Profile {
  const n = Math.floor(1000 + Math.random() * 9000);
  return { name: `Student${n}`, look: { body: 'male', skin: '#a36a45', hair: '#161210', shirt: '#7a1f2b', pants: '#243044', shoes: '#f2f2f2', accessory: '#2d59a8', seed: n } };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Profile;
      if (p?.name && p.look?.body) return p;
    }
  } catch { /* private window / blocked storage */ }
  const p = defaultProfile();
  saveProfile(p); // keep the generated name across reloads
  return p;
}

export function saveProfile(p: Profile): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private window / blocked storage */ }
}
