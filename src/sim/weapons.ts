export type WeaponId = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'bat';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  kind: 'gun' | 'melee';
  anim: 'rifle' | 'pistol' | 'bat';
  damage: number;
  headMult: number;
  rpm: number;
  auto: boolean;
  mag: number;
  reserve: number;
  reload: number; // seconds (per shell for shotgun)
  perShell?: boolean;
  spreadHip: number; // radians
  spreadAim: number;
  pellets: number;
  range: number;
  falloffStart: number;
  recoil: number; // camera kick (radians)
  moveMult: number;
  penetration: number; // extra zombies a bullet passes through
  stagger: number; // seconds of hit stun
  knockback: number;
  meleeRange?: number;
  meleeArc?: number; // radians
  sfx: string;
}

/**
 * Roles (balanced 2026-09-26): pistol = starter, strong only with headshots; SMG = close range, best from the hip and
 * on the move, falls off past 18 m; rifle = precise mid/long range (full damage to 50 m, passes through one zombie),
 * heavier: slower, more recoil, looser from the hip, similar close-range burst to the SMG; shotgun = one-shot crowd
 * control within ~10 m, useless beyond; bat = high risk crowd damage (up to 3 per swing). Hits pay by damage, so
 * overkill and spray farm nothing.
 */
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: { id: 'pistol', name: 'Glock-ish 9mm', kind: 'gun', anim: 'pistol', damage: 38, headMult: 2.6, rpm: 380, auto: false, mag: 12, reserve: 72, reload: 1.35, spreadHip: 0.022, spreadAim: 0.006, pellets: 1, range: 70, falloffStart: 25, recoil: 0.02, moveMult: 1.0, penetration: 0, stagger: 0.12, knockback: 0.3, sfx: 'pistol_fire' },
  smg: { id: 'smg', name: 'Canteen SMG', kind: 'gun', anim: 'rifle', damage: 26, headMult: 2.0, rpm: 850, auto: true, mag: 35, reserve: 245, reload: 1.8, spreadHip: 0.03, spreadAim: 0.013, pellets: 1, range: 55, falloffStart: 18, recoil: 0.012, moveMult: 0.98, penetration: 0, stagger: 0.08, knockback: 0.2, sfx: 'smg_fire' },
  rifle: { id: 'rifle', name: 'INSAS Rifle', kind: 'gun', anim: 'rifle', damage: 42, headMult: 2.6, rpm: 520, auto: true, mag: 30, reserve: 210, reload: 2.3, spreadHip: 0.036, spreadAim: 0.005, pellets: 1, range: 120, falloffStart: 50, recoil: 0.019, moveMult: 0.92, penetration: 1, stagger: 0.14, knockback: 0.35, sfx: 'rifle_fire' },
  shotgun: { id: 'shotgun', name: 'Security Pump', kind: 'gun', anim: 'rifle', damage: 21, headMult: 1.6, rpm: 78, auto: false, mag: 6, reserve: 42, reload: 0.52, perShell: true, spreadHip: 0.085, spreadAim: 0.06, pellets: 9, range: 32, falloffStart: 9, recoil: 0.06, moveMult: 0.93, penetration: 0, stagger: 0.45, knockback: 1.6, sfx: 'shotgun_fire' },
  bat: { id: 'bat', name: 'Cricket Bat', kind: 'melee', anim: 'bat', damage: 80, headMult: 1.5, rpm: 85, auto: false, mag: 0, reserve: 0, reload: 0, spreadHip: 0, spreadAim: 0, pellets: 0, range: 2.4, falloffStart: 2.4, recoil: 0.03, moveMult: 1.05, penetration: 2, stagger: 0.6, knockback: 2.4, meleeRange: 2.3, meleeArc: 1.9, sfx: 'bat_swing' },
};

export interface WeaponSlot {
  id: WeaponId;
  mag: number;
  reserve: number;
}

export function newSlot(id: WeaponId, full = true): WeaponSlot {
  const d = WEAPONS[id];
  return { id, mag: full ? d.mag : 0, reserve: full ? d.reserve : 0 };
}

/**
 * Frag grenade (thrown with G). Sim-only numbers; the World owns every live grenade (World.grenades) and announces
 * throws, bounces and blasts on the EventBus for render / audio / HUD.
 */
export const GRENADE = {
  /** carried at spawn / the most a survivor can hold (ammo crates top up to this) */
  start: 2,
  max: 4,
  /** seconds from leaving the hand to the blast */
  fuse: 2.5,
  /** blast radius (m) and damage at the centre on wave 1 (falls to 10 % at the edge, +10 % per wave) */
  radius: 7,
  damage: 320,
  /** throw animation length (s): no firing, reloading or switching while it plays */
  throwDur: 0.62,
  /** fraction of the throw at which the grenade leaves the hand */
  releaseAt: 0.42,
  /** farthest point (m from the hand) a throw is aimed at */
  maxRange: 28,
  gravity: 13,
  /** collision radius (m) */
  r: 0.07,
  /** bounce: share of the normal speed kept; share of the tangential speed kept off floors / off walls */
  restitution: 0.32,
  floorFriction: 0.5,
  wallFriction: 0.75,
  /** deceleration while rolling (m/s²): it comes to rest a few metres past where it lands */
  rollDecel: 5,
} as const;
