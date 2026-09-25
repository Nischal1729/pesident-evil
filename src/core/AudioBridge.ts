import * as THREE from 'three';
import { AudioManager, type SfxName } from '../audio/AudioManager';
import { BARKS, type BarkCategory } from '../audio/barks';
import type { World } from '../sim/World';

/** Maps gameplay events to sounds, music intensity, ambience and NPC barks. */
export class AudioBridge {
  audio = new AudioManager();
  ready = false;
  private lastImpact = 0;
  private lastGateHit = 0;
  private zombieVoices = 0;
  private voiceWindow = 0;
  private extraLines: Record<string, string[]> = {
    hold: ['Holding here, guru.', 'Okay, we stay put.', 'Setting up here. Come back for us!'],
    follow: ['Right behind you!', 'Coming, coming!', 'Lead the way, boss.'],
  };

  async init(onProgress?: (f: number, label: string) => void): Promise<void> {
    await this.audio.init(onProgress);
    this.ready = true;
  }

  attach(world: World): () => void {
    const ev = world.events;
    const a = this.audio;
    const offs: (() => void)[] = [];
    const play = (n: SfxName, position?: THREE.Vector3, volume?: number, pitch?: number) => { if (this.ready) a.play(n, { position, volume, pitch }); };
    const isLocal = (id: number) => id === world.localPlayerId;
    offs.push(ev.on('shot', (e) => {
      if (world.role === 'client' && isLocal(e.shooterId) && !e.predicted) return; // played when predicted
      const n: SfxName = e.weapon === 'pistol' ? 'pistol_fire' : e.weapon === 'shotgun' ? 'shotgun_fire' : e.weapon === 'smg' ? 'smg_fire' : 'rifle_fire';
      play(n, isLocal(e.shooterId) ? undefined : e.origin, isLocal(e.shooterId) ? 0.85 : 1);
    }));
    offs.push(ev.on('dryFire', (e) => play('dry_fire', isLocal(e.actorId) ? undefined : e.position)));
    offs.push(ev.on('impact', (e) => {
      const now = performance.now();
      if (now - this.lastImpact < 25) return;
      this.lastImpact = now;
      play(e.surface === 'metal' ? 'impact_metal' : e.surface === 'wood' ? 'impact_wood' : 'impact_concrete', e.point, 0.7);
    }));
    offs.push(ev.on('hit', (e) => {
      if (e.headshot && world.localPlayerId === e.attackerId) play('headshot', e.point, 0.9);
      else play('impact_flesh', e.point, 0.8);
    }));
    offs.push(ev.on('death', (e) => {
      if (e.kind === 'zombie') play('zombie_death', e.position, 0.9);
      else if (e.kind === 'player' && isLocal(e.id)) play('player_death');
    }));
    offs.push(ev.on('zombieGroan', (e) => {
      const now = performance.now();
      if (now - this.voiceWindow > 1000) { this.voiceWindow = now; this.zombieVoices = 0; }
      if (this.zombieVoices++ > 5) return;
      play(e.kind === 'scream' ? 'zombie_scream' : e.kind === 'near' ? 'zombie_growl_near' : 'zombie_groan', e.position);
    }));
    offs.push(ev.on('zombieAttack', (e) => play('zombie_attack', e.position)));
    offs.push(ev.on('gateHit', (e) => {
      const now = performance.now();
      if (now - this.lastGateHit < 180) return;
      this.lastGateHit = now;
      play('zombie_hit_door', e.position);
    }));
    offs.push(ev.on('gateBroken', (e) => { play('gate_close', e.position, 1, 0.7); play('zombie_scream', e.position); }));
    offs.push(ev.on('gateRepaired', (e) => play('barricade_repair', e.position, 0.8)));
    offs.push(ev.on('reload', (e) => {
      const pos = isLocal(e.actorId) ? undefined : e.position;
      if (e.stage === 'magOut') play('reload_mag_out', pos, 0.8);
      else if (e.stage === 'magIn') play(e.weapon === 'shotgun' ? 'shell_insert' : 'reload_mag_in', pos, 0.8);
      else if (e.stage === 'end' || e.stage === 'rack') play(e.weapon === 'shotgun' ? 'shotgun_pump' : 'reload_rack', pos, 0.8);
    }));
    offs.push(ev.on('weaponSwitch', (e) => { if (isLocal(e.actorId)) play('weapon_switch'); }));
    offs.push(ev.on('meleeSwing', (e) => play('bat_swing', isLocal(e.actorId) ? undefined : e.position)));
    offs.push(ev.on('grenadeThrow', (e) => {
      const pos = isLocal(e.actorId) ? undefined : e.position;
      if (e.stage === 'pin') play('grenade_pin', pos, 0.9);
      else play('bat_swing', pos, 0.5, 1.4); // a lighter, quicker whoosh as it leaves the hand
    }));
    offs.push(ev.on('grenadeBounce', (e) => play('grenade_bounce', e.position, THREE.MathUtils.clamp(e.speed / 9, 0.3, 1), e.surface === 'metal' ? 1.25 : e.surface === 'wood' ? 0.85 : 1)));
    offs.push(ev.on('grenadeExplode', (e) => play('grenade_explosion', e.position)));
    offs.push(ev.on('footstep', (e) => { if (isLocal(e.actorId)) play('footstep_concrete', undefined, e.loud ? 0.5 : 0.3); else play('footstep_concrete', e.position, 0.25); }));
    offs.push(ev.on('land', (e) => { if (isLocal(e.actorId)) play('jump_land', undefined, 0.6); }));
    offs.push(ev.on('playerDamaged', (e) => { if (isLocal(e.playerId)) play('player_hurt'); }));
    offs.push(ev.on('pickup', (e) => {
      const pos = isLocal(e.playerId) ? undefined : world.survivors.find((s) => s.id === e.playerId)?.pos;
      if (!isLocal(e.playerId) && !pos) return;
      play(e.kind === 'ammo' ? 'pickup_ammo' : e.kind === 'health' ? 'pickup_health' : 'pickup_weapon', pos, isLocal(e.playerId) ? 1 : 0.6);
    }));
    offs.push(ev.on('points', (e) => { if (e.amount >= 50) play('points_ding', undefined, 0.35); }));
    offs.push(ev.on('waveStart', () => play('wave_start')));
    offs.push(ev.on('waveEnd', () => play('wave_end')));
    offs.push(ev.on('prepTick', (e) => { if (e.secondsLeft <= 5 && e.secondsLeft > 0) play('round_counter_tick', undefined, 0.5); }));
    offs.push(ev.on('revived', (e) => play('revive_progress', world.survivors.find((s) => s.id === e.id)?.pos)));
    offs.push(ev.on('bark', (e) => {
      if (!this.ready) return;
      const character = world.survivors.find((s) => s.id === e.actorId)?.name;
      if (e.category in BARKS) a.bark(e.category as BarkCategory, { voice: e.voice, character, position: e.position });
      else {
        const lines = this.extraLines[e.category];
        if (lines) a.say(lines[Math.floor(Math.random() * lines.length)], { voice: e.voice, character, position: e.position });
      }
    }));
    offs.push(ev.on('waveStart', (e) => {
      const n = world.survivors.find((s) => s.kind === 'npc' && s.active);
      if (n && this.ready && 'waveStart' in BARKS) setTimeout(() => a.bark('waveStart' as BarkCategory, { voice: n.voice, character: n.name, position: n.pos }), 2500);
      void e;
    }));
    offs.push(ev.on('waveEnd', () => {
      const n = world.survivors.find((s) => s.kind === 'npc' && s.active);
      if (n && this.ready && 'waveClear' in BARKS) setTimeout(() => a.bark('waveClear' as BarkCategory, { voice: n.voice, character: n.name, position: n.pos }), 1800);
    }));
    return () => offs.forEach((o) => o());
  }

  /** Per-frame: listener, music intensity, ambience by time of day, low-health heartbeat. */
  update(dt: number, world: World, camera: THREE.Camera): void {
    if (!this.ready) return;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    this.audio.setListener(camera.position, fwd, up);
    const p = world.player;
    let near = 0;
    if (p) for (const z of world.zombies) if (z.alive && z.pos.distanceTo(p.pos) < 30) near++;
    const intensity = world.state === 'active' ? Math.min(1, 0.25 + near / 18) : world.state === 'prep' ? 0.12 : 0.05;
    this.audio.setMusicIntensity(intensity);
    const t = world.timeOfDay;
    this.audio.setAmbience(t < 0.35 ? 'day' : t < 0.7 ? 'dusk' : 'night', 1);
    if (p) this.audio.setLowHealth(p.alive && !p.downed ? THREE.MathUtils.clamp(1 - p.health / 45, 0, 1) : p.downed ? 1 : 0);
    this.audio.update(dt);
  }
}
