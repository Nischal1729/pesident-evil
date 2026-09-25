/**
 * Input abstraction. The simulation only ever sees `PlayerInput` snapshots, so a future
 * co-op layer can feed remote players' inputs through the same path.
 */
export interface PlayerInput {
  moveX: number; // -1..1 strafe (right +)
  moveZ: number; // -1..1 forward (+)
  yaw: number; // radians, camera yaw (0 = looking toward -Z)
  pitch: number; // radians, + looks up
  camX: number; camY: number; camZ: number; // world-space render camera position at the start of the tick; NaN = not provided
  camAlpha: number; // fraction of this tick's player movement the rendered camera follows (render interpolation alpha)
  fire: boolean;
  aim: boolean;
  sprint: boolean;
  // Edge-triggered (latched until consumed by a sim tick)
  reload: boolean;
  interact: boolean; // held state
  interactPressed: boolean;
  jump: boolean;
  melee: boolean;
  command: boolean; // toggle NPC follow/hold
  weaponSlot: number; // -1 = none
  weaponScroll: number; // -1, 0, 1
}

export function emptyInput(): PlayerInput {
  return {
    moveX: 0, moveZ: 0, yaw: 0, pitch: 0, camX: NaN, camY: NaN, camZ: NaN, camAlpha: 0, fire: false, aim: false, sprint: false,
    reload: false, interact: false, interactPressed: false, jump: false, melee: false, command: false,
    weaponSlot: -1, weaponScroll: 0,
  };
}

export class Input {
  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private latched = { reload: false, interact: false, jump: false, melee: false, command: false, slot: -1, scroll: 0 };
  private recoilDebt = 0;
  private sinceShot = 99;
  yaw = 0;
  pitch = -0.08;
  sensitivity = 1;
  invertY = false;
  locked = false;
  enabled = true;
  onLockChange: ((locked: boolean) => void) | null = null;
  onPause: (() => void) | null = null;

  constructor(private element: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    element.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.clear(); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) { this.keys.clear(); this.mouseButtons.clear(); }
      this.onLockChange?.(this.locked);
    });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestLock(): void {
    const p = this.element.requestPointerLock?.() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => { /* user gesture required */ });
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    if (e.code === 'Escape' || e.code === 'KeyP') { this.onPause?.(); return; }
    if (e.repeat) return;
    this.keys.add(e.code);
    switch (e.code) {
      case 'KeyR': this.latched.reload = true; break;
      case 'KeyE': this.latched.interact = true; break;
      case 'Space': this.latched.jump = true; e.preventDefault(); break;
      case 'KeyV': case 'KeyQ': this.latched.melee = true; break;
      case 'KeyF': this.latched.command = true; break;
      case 'Digit1': this.latched.slot = 0; break;
      case 'Digit2': this.latched.slot = 1; break;
      case 'Digit3': this.latched.slot = 2; break;
      case 'Digit4': this.latched.slot = 3; break;
      case 'Digit5': this.latched.slot = 4; break;
    }
    if (e.code === 'Tab') e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (!this.locked) return;
    this.mouseButtons.add(e.button);
  };

  private onMouseUp = (e: MouseEvent) => { this.mouseButtons.delete(e.button); };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked || !this.enabled) return;
    const s = 0.0022 * this.sensitivity * (this.isDown('aim') ? 0.6 : 1);
    this.yaw -= e.movementX * s;
    const before = this.pitch;
    this.pitch -= e.movementY * s * (this.invertY ? -1 : 1);
    this.pitch = Math.max(-1.25, Math.min(1.1, this.pitch));
    // manual downward compensation for recoil shouldn't also be recovered automatically
    const removed = before - this.pitch;
    if (removed > 0) this.recoilDebt = Math.max(0, this.recoilDebt - removed);
  };

  /** Camera kick from a shot: raises pitch (owing half back as recoverable debt) and nudges yaw sideways (permanent). */
  addRecoil(k: number, aiming: boolean): void {
    const s = aiming ? 0.7 : 1;
    const up = k * s;
    const side = (Math.random() * 2 - 1) * k * s * 0.4;
    const before = this.pitch;
    this.pitch = Math.max(-1.25, Math.min(1.1, this.pitch + up));
    this.yaw += side;
    // owe back only the rise the clamp let through, or recovery at the upper limit drags the aim below where it was held
    this.recoilDebt += (this.pitch - before) * 0.5;
    this.sinceShot = 0;
  }

  resetRecoil(): void { this.recoilDebt = 0; }

  /** Recovers half of each kick's pitch, starting 0.12s after the last shot. */
  updateRecoil(dt: number): void {
    this.sinceShot += dt;
    if (this.sinceShot > 0.12 && this.recoilDebt > 0) {
      const r = this.recoilDebt * Math.min(1, dt * 8);
      this.pitch -= r;
      this.recoilDebt -= r;
    }
  }

  private onWheel = (e: WheelEvent) => {
    if (!this.locked || !this.enabled) return;
    this.latched.scroll = e.deltaY > 0 ? 1 : -1;
  };

  private isDown(what: 'aim'): boolean {
    if (what === 'aim') return this.mouseButtons.has(2);
    return false;
  }

  key(code: string): boolean { return this.keys.has(code); }

  /** Snapshot for one sim tick. `consume` clears latched edge events. */
  sample(out: PlayerInput, consume: boolean): PlayerInput {
    const k = this.keys;
    out.moveX = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    out.moveZ = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    out.yaw = this.yaw;
    out.pitch = this.pitch;
    out.fire = this.mouseButtons.has(0);
    out.aim = this.mouseButtons.has(2);
    out.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    out.interact = k.has('KeyE');
    out.reload = this.latched.reload;
    out.interactPressed = this.latched.interact;
    out.jump = this.latched.jump;
    out.melee = this.latched.melee;
    out.command = this.latched.command;
    out.weaponSlot = this.latched.slot;
    out.weaponScroll = this.latched.scroll;
    if (consume) {
      this.latched.reload = this.latched.interact = this.latched.jump = this.latched.melee = this.latched.command = false;
      this.latched.slot = -1;
      this.latched.scroll = 0;
    }
    return out;
  }
}
