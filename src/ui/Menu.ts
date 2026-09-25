import { loadHighScore, type Quality, type Settings } from '../core/Settings';

type MenuScreen = 'loading' | 'main' | 'pause' | 'settings' | 'controls' | 'gameover' | 'none';

export interface MenuCallbacks {
  onPlay: () => void;
  onResume: () => void;
  onQuitToMenu: () => void;
  onRestart: () => void;
  onSettings: (s: Settings) => void;
}

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'], ['Mouse', 'Look / aim'], ['Left click', 'Shoot / swing bat'], ['Right click', 'Aim down sights'],
  ['Shift', 'Sprint'], ['Space', 'Jump'], ['R', 'Reload'], ['E (hold)', 'Interact · buy · revive · repair gate'],
  ['1-4 / wheel', 'Switch weapon'], ['V / Q', 'Quick bat swing'], ['G', 'Throw grenade (lands at the crosshair)'], ['F', 'Squad: hold position / follow me'], ['C', 'Swap shoulder'],
  ['T', 'Camera: near / far / high'], ['N', 'Start next wave now'], ['Esc / P', 'Pause'],
];

const TIPS = [
  'Bullets pass through the steel gate bars — shoot them while they bash it.',
  'Headshots are worth extra points. The cricket bat is worth even more.',
  'Hold E at the gate between waves to rebuild it.',
  'Press F to tell your friends to hold a spot — or to follow you again.',
  'Downed friends can be revived. Stand close and hold E.',
  'The canteen stash near South Thindies has an SMG. The NCC armoury by the MRD block has a rifle.',
  'Later waves come round to the west gate on PES University Road.',
  'Press G to throw a grenade where you aim. Ammo crates restock them — up to four.',
];

export class Menu {
  root = document.createElement('div');
  private screen: MenuScreen = 'none';
  private prev: MenuScreen = 'main';
  private progress = 0;
  private progressLabel = '';
  private goStats = { wave: 0, kills: 0, points: 0 };

  constructor(parent: HTMLElement, private settings: Settings, private cb: MenuCallbacks) {
    this.root.className = 'menu';
    parent.append(this.root);
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => this.onInput(e));
  }

  get current(): MenuScreen { return this.screen; }

  show(s: MenuScreen): void {
    if (s !== 'settings' && s !== 'controls') this.prev = s;
    this.screen = s;
    this.render();
  }

  setProgress(f: number, label: string): void {
    this.progress = f;
    this.progressLabel = label;
    if (this.screen === 'loading') {
      const bar = this.root.querySelector('.m-progress > div') as HTMLElement | null;
      const lab = this.root.querySelector('.m-progress-label') as HTMLElement | null;
      if (bar) bar.style.width = `${Math.round(f * 100)}%`;
      if (lab) lab.textContent = label;
    }
  }

  gameOver(wave: number, kills: number, points: number): void {
    this.goStats = { wave, kills, points };
    this.show('gameover');
  }

  private title(): string {
    return `<div class="m-title"><div class="m-kicker">PES UNIVERSITY · RING ROAD CAMPUS · BENGALURU</div><h1><span>PES</span>IDENT EVIL</h1></div>`;
  }

  private render(): void {
    const s = this.settings;
    const hs = loadHighScore();
    let html = '';
    switch (this.screen) {
      case 'none': html = ''; break;
      case 'loading':
        html = `<div class="m-panel m-center">${this.title()}
          <div class="m-progress"><div style="width:${Math.round(this.progress * 100)}%"></div></div>
          <div class="m-progress-label">${this.progressLabel}</div>
          <div class="m-tip">${TIPS[Math.floor(Math.random() * TIPS.length)]}</div></div>`;
        break;
      case 'main':
        html = `<div class="m-panel m-left">${this.title()}
          <p class="m-blurb">The evening bell never rang. Something came down the Outer Ring Road, and now it wants in.
          Hold the campus with your friends until dawn — or until the attendance shortage is the least of your problems.</p>
          <div class="m-buttons">
            <button data-a="play" class="primary">Play</button>
            <button data-a="settings">Settings</button>
            <button data-a="controls">Controls</button>
          </div>
          ${hs ? `<div class="m-hs">Best: wave ${hs.wave} · ${hs.kills} kills · ${hs.points.toLocaleString('en-IN')} pts</div>` : ''}
          <div class="m-foot">Single player with AI squad · co-op coming later · Map data © OpenStreetMap contributors · Textures CC0 Poly Haven</div></div>`;
        break;
      case 'pause':
        html = `<div class="m-panel m-center"><h2>Paused</h2><div class="m-buttons">
          <button data-a="resume" class="primary">Resume</button><button data-a="settings">Settings</button>
          <button data-a="controls">Controls</button><button data-a="quit">Quit to menu</button></div></div>`;
        break;
      case 'gameover': {
        const g = this.goStats;
        html = `<div class="m-panel m-center m-go"><h2>You didn't make it</h2>
          <div class="m-stats"><div><b>${g.wave}</b><span>waves</span></div><div><b>${g.kills}</b><span>kills</span></div><div><b>${g.points.toLocaleString('en-IN')}</b><span>points</span></div></div>
          ${hs ? `<div class="m-hs">Best: wave ${hs.wave} · ${hs.kills} kills</div>` : ''}
          <div class="m-buttons"><button data-a="restart" class="primary">Try again</button><button data-a="quit">Main menu</button></div></div>`;
        break;
      }
      case 'controls':
        html = `<div class="m-panel m-center"><h2>Controls</h2><table class="m-controls">${CONTROLS.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}</table>
          <div class="m-buttons"><button data-a="back" class="primary">Back</button></div></div>`;
        break;
      case 'settings': {
        const q = (v: Quality) => `<option value="${v}" ${s.quality === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`;
        html = `<div class="m-panel m-center"><h2>Settings</h2><div class="m-form">
          <label>Graphics quality <select data-s="quality">${q('low')}${q('medium')}${q('high')}${q('ultra')}</select></label>
          <label>Mouse sensitivity <input type="range" min="0.2" max="3" step="0.05" data-s="sensitivity" value="${s.sensitivity}"><output>${s.sensitivity.toFixed(2)}</output></label>
          <label>Field of view <input type="range" min="50" max="85" step="1" data-s="fov" value="${s.fov}"><output>${s.fov}</output></label>
          <label>Invert Y <input type="checkbox" data-s="invertY" ${s.invertY ? 'checked' : ''}></label>
          <label>Master volume <input type="range" min="0" max="1" step="0.01" data-s="masterVolume" value="${s.masterVolume}"><output>${Math.round(s.masterVolume * 100)}</output></label>
          <label>Music volume <input type="range" min="0" max="1" step="0.01" data-s="musicVolume" value="${s.musicVolume}"><output>${Math.round(s.musicVolume * 100)}</output></label>
          <label>Effects volume <input type="range" min="0" max="1" step="0.01" data-s="sfxVolume" value="${s.sfxVolume}"><output>${Math.round(s.sfxVolume * 100)}</output></label>
          <label>Squad voice lines <input type="checkbox" data-s="npcVoices" ${s.npcVoices ? 'checked' : ''}></label>
          <label>Show FPS <input type="checkbox" data-s="showFps" ${s.showFps ? 'checked' : ''}></label>
          <div class="m-note">Quality changes to shadows/AO apply on next load.</div>
          </div><div class="m-buttons"><button data-a="back" class="primary">Back</button></div></div>`;
        break;
      }
    }
    this.root.innerHTML = html;
    this.root.style.display = this.screen === 'none' ? 'none' : '';
    this.root.classList.toggle('dim', this.screen !== 'main' && this.screen !== 'loading');
  }

  private onClick(e: Event): void {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    switch (b.dataset.a) {
      case 'play': this.cb.onPlay(); break;
      case 'resume': this.cb.onResume(); break;
      case 'settings': this.show('settings'); this.screen = 'settings'; break;
      case 'controls': this.show('controls'); break;
      case 'back': this.show(this.prev); break;
      case 'quit': this.cb.onQuitToMenu(); break;
      case 'restart': this.cb.onRestart(); break;
    }
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const key = t.dataset.s as keyof Settings | undefined;
    if (!key) return;
    const s = this.settings as unknown as Record<string, unknown>;
    if (t instanceof HTMLInputElement && t.type === 'checkbox') s[key] = t.checked;
    else if (t instanceof HTMLInputElement && t.type === 'range') {
      s[key] = Number(t.value);
      const out = t.nextElementSibling as HTMLOutputElement | null;
      if (out) out.textContent = key.includes('Volume') ? String(Math.round(Number(t.value) * 100)) : key === 'fov' ? t.value : Number(t.value).toFixed(2);
    } else s[key] = t.value;
    this.cb.onSettings(this.settings);
  }
}
