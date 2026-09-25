import type { Vector3 } from 'three';

export type SurfaceKind = 'flesh' | 'concrete' | 'metal' | 'wood' | 'ground';

/** Gameplay events. Payloads are plain data so they can be networked later. */
export interface GameEvents {
  shot: { shooterId: number; weapon: string; origin: Vector3; end: Vector3; hitSurface: SurfaceKind | null };
  hit: { targetId: number; attackerId: number; damage: number; point: Vector3; normal: Vector3; headshot: boolean; surface: SurfaceKind };
  impact: { point: Vector3; normal: Vector3; surface: SurfaceKind };
  death: { id: number; kind: 'zombie' | 'npc' | 'player'; killerId: number; headshot: boolean; position: Vector3 };
  downed: { id: number; kind: 'npc' | 'player'; position: Vector3 };
  revived: { id: number; byId: number };
  zombieAttack: { id: number; targetId: number; position: Vector3 };
  zombieGroan: { id: number; position: Vector3; kind: 'groan' | 'near' | 'scream' };
  gateHit: { hp: number; maxHp: number; position: Vector3 };
  gateBroken: { position: Vector3 };
  gateRepaired: { hp: number; maxHp: number; position: Vector3 };
  waveStart: { wave: number; count: number };
  waveEnd: { wave: number };
  prepTick: { wave: number; secondsLeft: number };
  points: { playerId: number; amount: number; total: number; reason: string };
  pickup: { playerId: number; kind: 'ammo' | 'health' | 'weapon'; item: string };
  reload: { actorId: number; weapon: string; stage: 'start' | 'magOut' | 'magIn' | 'rack' | 'end'; position: Vector3 };
  weaponSwitch: { actorId: number; weapon: string };
  meleeSwing: { actorId: number; position: Vector3 };
  footstep: { actorId: number; position: Vector3; surface: 'concrete' | 'grass'; loud: boolean };
  bark: { actorId: number; category: string; position: Vector3; voice: 'male' | 'female' };
  message: { text: string; kind: 'info' | 'warn' | 'good' };
  playerDamaged: { playerId: number; amount: number; fromDir: Vector3 | null; health: number };
  gameOver: { wave: number; kills: number; points: number };
  jump: { actorId: number; position: Vector3 };
  dryFire: { actorId: number; position: Vector3 };
  land: { actorId: number; position: Vector3 };
  /** a survivor pulls the pin ('pin', start of the throw) and lets go ('release', the grenade is live in World.grenades) */
  grenadeThrow: { actorId: number; stage: 'pin' | 'release'; position: Vector3 };
  /** a flying grenade hits something hard enough to clatter */
  grenadeBounce: { id: number; position: Vector3; speed: number; surface: SurfaceKind };
  /** blast at `position` (the grenade's centre); `floorY` is the surface it lay on / over, `kills` zombies it killed */
  grenadeExplode: { id: number; ownerId: number; position: Vector3; floorY: number; radius: number; kills: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object = GameEvents> {
  private handlers = new Map<keyof E, Set<Handler<any>>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
