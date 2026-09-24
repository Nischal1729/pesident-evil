/**
 * Input abstraction. The simulation only ever sees `PlayerInput` snapshots, so a future
 * co-op layer can feed remote players' inputs through the same path.
 */
export interface PlayerInput {
  moveX: number; // -1..1 strafe (right +)
  moveZ: number; // -1..1 forward (+)
  yaw: number; // radians, camera yaw (0 = looking toward -Z)
  pitch: number; // radians, + looks up
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
    moveX: 0, moveZ: 0, yaw: 0, pitch: 0, fire: false, aim: false, sprint: false,
    reload: false, interact: false, interactPressed: false, jump: false, melee: false, command: false,
    weaponSlot: -1, weaponScroll: 0,
  };
}

export class Input {
  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private latched = { reload: false, interact: false, jump: false, melee: false, command: false, slot: -1, scroll: 0 };
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
    this.pitch -= e.movementY * s * (this.invertY ? -1 : 1);
    this.pitch = Math.max(-1.25, Math.min(1.1, this.pitch));
  };

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
