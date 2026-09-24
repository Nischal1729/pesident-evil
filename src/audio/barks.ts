/**
 * NPC barks via the Web Speech API.
 *
 * speechSynthesis cannot be routed through WebAudio, so it can't be spatialised: we
 * approximate by scaling utterance volume with distance to the listener and skipping
 * barks that are too far away. Voices: Indian-English preferred (macOS "Rishi" / "Veena",
 * Windows "Ravi" / "Heera", Edge "Prabhat" / "Neerja"), then any English voice.
 */

export const BARKS = {
  reloading: [
    'Reloading, cover me macha!',
    'Changing mag, swalpa cover maadi!',
    'Reloading! Hold them, guru!',
    'Out! Reloading, reloading!',
    'Give me two seconds da, reloading!',
    'Mag empty, cover me yaar!',
    "Reloading, don't let them near me!",
    'Hold on, reloading. Slower than the college Wi-Fi, this.',
  ],
  spotted: [
    "They're coming through the main gate!",
    'Zombies near the food court!',
    'Contact! Over by GJB!',
    'Arre, more of them on the Ring Road!',
    'Sprinter! Sprinter coming fast!',
    'Behind you, maga!',
    'Big group coming in, get ready!',
    "They're near the library, watch it!",
    'Aiyyo, look at that crowd. Worse than Silk Board!',
  ],
  hurt: [
    "I'm hurt, I'm hurt!",
    'Aiyyo! It bit me!',
    'Need a medkit, quick!',
    'Ah! That one got me!',
    "I'm bleeding here, macha!",
    "Help me, guru, I'm going down!",
    'Ow! Get it off me!',
  ],
  kill: [
    'Sorted!',
    'One down, guru!',
    'Sakkath shot!',
    'Bombat! Got him!',
    'Stay down, da!',
    "That's one less for the attendance register.",
    'Attendance shortage. Detained!',
    'Down he goes!',
    'Headshot, maga!',
  ],
  revive: [
    'Get up da, get up!',
    "Hold on, I've got you!",
    "Don't you dare die before ESA, macha!",
    'Up, up! Back on your feet!',
    'Stay with me, guru!',
    "Come on, I'm not submitting your assignment for you!",
    "Easy, easy, I'm helping you up.",
  ],
  downed: [
    "I'm down! Somebody help!",
    "Macha, I'm down! Revive me!",
    "Can't get up! Help, yaar!",
    "Aiyyo, I'm down, I'm down!",
    'Tell my amma I tried to study!',
    'Need a hand here, guru!',
    'Somebody pick me up, please!',
  ],
  waveClear: [
    "Is it over? Please tell me it's over.",
    'Worse than ESA week, this.',
    'Phew! Somebody get me a filter coffee.',
    "Sorted! That's the wave, guys.",
    'Bombat, we survived!',
    'Okay, breathe. Everybody still here?',
    "I'd rather write three back-to-back exams than do that again.",
    'Canteen break, five minutes, then we go again.',
  ],
  waveStart: [
    'Here they come again!',
    "That's the bell! Everyone to your positions!",
    'Next period starts now, guys!',
    "Get ready, macha, they're coming!",
    'Main gate! Hold the main gate!',
    'Chalo, chalo, positions!',
    "Arre, didn't this class just end?",
    'Ring Road is full of them, get ready!',
  ],
  lowAmmo: [
    'Running low on ammo!',
    'Almost out, anyone have spare mags?',
    'Last mag, macha!',
    'Ammo, ammo! I need ammo!',
    'Few rounds left, yaar!',
    'Need to find an ammo crate, quick!',
    'Swalpa ammo kodi, anyone?',
  ],
  thanks: [
    'Thanks, macha!',
    'Thank you, guru, owe you one!',
    'Nice save, da!',
    'Lifesaver! Canteen treat on me.',
    'Sakkath! Thanks!',
    "You're the best, yaar.",
    'I owe you a masala dosa for that one.',
    'Thanks! Proxy attendance for you, all semester.',
  ],
} as const satisfies Record<string, readonly string[]>;

export type BarkCategory = keyof typeof BARKS;

/** Pick a random line from a category (avoids repeating the previous pick). */
const lastPick = new Map<BarkCategory, number>();
export function randomBark(cat: BarkCategory): string {
  const lines = BARKS[cat];
  let i = Math.floor(Math.random() * lines.length);
  if (lines.length > 1 && i === lastPick.get(cat)) i = (i + 1) % lines.length;
  lastPick.set(cat, i);
  return lines[i]!;
}

export type VoiceGender = 'male' | 'female';

export interface SayOptions {
  voice?: VoiceGender;
  position?: { x: number; y: number; z: number };
  /** Higher priority barks jump the queue and may interrupt a lower one (default 1). */
  priority?: number;
  /** Extra per-line volume multiplier. */
  volume?: number;
}

interface QueuedBark {
  text: string;
  gender: VoiceGender;
  pos?: { x: number; y: number; z: number };
  priority: number;
  volume: number;
  at: number;
}

const IN_MALE = ['rishi', 'ravi', 'prabhat', 'hemant', 'aarav', 'arjun', 'kunal', 'madhur', 'kumar', 'raj'];
const IN_FEMALE = ['veena', 'heera', 'neerja', 'isha', 'lekha', 'kalpana', 'aditi', 'raveena', 'sangeeta', 'kajal', 'swara', 'ananya', 'priya', 'pallavi'];
const EN_MALE = ['daniel', 'alex', 'fred', 'tom', 'aaron', 'arthur', 'oliver', 'gordon', 'lee', 'reed', 'eddy', 'guy', 'david', 'mark', 'george', 'james', 'ryan', 'thomas', 'rocko', 'grandpa', 'evan', 'nathan'];
const EN_FEMALE = ['samantha', 'victoria', 'karen', 'moira', 'tessa', 'fiona', 'serena', 'kate', 'susan', 'zira', 'allison', 'ava', 'nicky', 'martha', 'catherine', 'hazel', 'libby', 'sonia', 'jenny', 'aria', 'emma', 'flo', 'sandy', 'shelley', 'grandma', 'zoe', 'joelle', 'kathy'];
const NOVELTY = ['bad news', 'bells', 'boing', 'bubbles', 'cellos', 'deranged', 'good news', 'hysterical', 'pipe organ', 'trinoids', 'whisper', 'zarvox', 'albert', 'bahh', 'jester', 'organ', 'superstar', 'wobble', 'junior', 'ralph'];
/** macOS "Eloquence" voices: understandable but robotic. */
const ROBOTIC = ['eddy', 'flo', 'grandma', 'grandpa', 'reed', 'rocko', 'sandy', 'shelley', 'fred', 'kathy'];
/** Natural-sounding fallbacks when no en-IN voice of the wanted gender is installed. */
const NATURAL: Record<string, number> = { samantha: 8, daniel: 8, karen: 6, moira: 6, tessa: 6, serena: 6, arthur: 5, oliver: 5, kate: 4, catherine: 3 };

function isEnIN(v: SpeechSynthesisVoice): boolean {
  return v.lang.replace('_', '-').toLowerCase().startsWith('en-in');
}
function isEnglish(v: SpeechSynthesisVoice): boolean {
  return v.lang.toLowerCase().startsWith('en');
}
function genderOf(v: SpeechSynthesisVoice): VoiceGender | null {
  const n = v.name.toLowerCase();
  if (n.includes('female')) return 'female';
  if (/\bmale\b/.test(n)) return 'male';
  if (IN_FEMALE.some((k) => n.includes(k)) || EN_FEMALE.some((k) => n.includes(k))) return 'female';
  if (IN_MALE.some((k) => n.includes(k)) || EN_MALE.some((k) => n.includes(k))) return 'male';
  return null;
}

function score(v: SpeechSynthesisVoice, want: VoiceGender): number {
  const n = v.name.toLowerCase();
  let s = 0;
  if (isEnIN(v)) s += 100;
  else if (isEnglish(v)) s += 20;
  else return -1000;
  if (NOVELTY.some((k) => n.includes(k))) s -= 200;
  if (ROBOTIC.some((k) => n.startsWith(k))) s -= 15;
  for (const [k, bonus] of Object.entries(NATURAL)) if (n.startsWith(k)) s += bonus;
  const g = genderOf(v);
  if (g === want) s += 40;
  else if (g !== null) s -= 60;
  if (v.localService) s += 5;
  if (n.includes('premium') || n.includes('enhanced') || n.includes('natural')) s += 8;
  return s;
}

export class Barker {
  private voices: SpeechSynthesisVoice[] = [];
  private chosen: Record<VoiceGender, SpeechSynthesisVoice | null> = { male: null, female: null };
  private queue: QueuedBark[] = [];
  private current: SpeechSynthesisUtterance | null = null;
  private currentPriority = 0;
  private watchdog = 0;
  private recent = new Map<string, number>();
  private lastEnd = 0;
  private readonly synth: SpeechSynthesis | null;
  volume = 1;
  maxDistance = 45;
  refDistance = 6;
  maxQueue = 2;

  constructor(private readonly listener: () => { x: number; y: number; z: number }) {
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    if (this.synth) {
      this.loadVoices();
      this.synth.addEventListener?.('voiceschanged', () => this.loadVoices());
    }
  }

  get available(): boolean {
    return this.synth !== null;
  }

  /** All voices and which ones were chosen (for the test page). */
  get voiceInfo(): { all: SpeechSynthesisVoice[]; male: SpeechSynthesisVoice | null; female: SpeechSynthesisVoice | null } {
    return { all: this.voices, male: this.chosen.male, female: this.chosen.female };
  }

  loadVoices(): void {
    if (!this.synth) return;
    this.voices = this.synth.getVoices();
    for (const g of ['male', 'female'] as const) {
      let best: SpeechSynthesisVoice | null = null;
      let bs = -Infinity;
      for (const v of this.voices) {
        const s = score(v, g);
        if (s > bs) {
          bs = s;
          best = v;
        }
      }
      this.chosen[g] = bs > -100 ? best : null;
    }
  }

  say(text: string, opts: SayOptions = {}): void {
    if (!this.synth || !text) return;
    if (this.voices.length === 0) this.loadVoices();
    const now = performance.now();
    const last = this.recent.get(text);
    if (last !== undefined && now - last < 4000) return;
    const pos = opts.position ? { x: opts.position.x, y: opts.position.y, z: opts.position.z } : undefined;
    if (pos && this.distance(pos) > this.maxDistance) return;
    const item: QueuedBark = {
      text,
      gender: opts.voice ?? (Math.random() < 0.5 ? 'male' : 'female'),
      pos,
      priority: opts.priority ?? 1,
      volume: opts.volume ?? 1,
      at: now,
    };
    this.recent.set(text, now);
    if (this.current && item.priority > this.currentPriority + 1) {
      // urgent line (e.g. "I'm down!") cuts off chatter
      this.queue.unshift(item);
      this.synth.cancel();
      window.clearTimeout(this.watchdog);
      this.current = null;
      // Chrome can drop a speak() issued in the same tick as cancel().
      window.setTimeout(() => this.pump(), 60);
      return;
    }
    this.queue.push(item);
    this.queue.sort((a, b) => b.priority - a.priority || a.at - b.at);
    while (this.queue.length > this.maxQueue) this.queue.pop();
    this.pump();
  }

  cancel(): void {
    this.queue = [];
    this.synth?.cancel();
    this.current = null;
  }

  private distance(p: { x: number; y: number; z: number }): number {
    const l = this.listener();
    return Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z);
  }

  private pump(): void {
    if (!this.synth || this.current) return;
    const now = performance.now();
    // stale barks are worse than none
    this.queue = this.queue.filter((q) => now - q.at < 2500);
    const item = this.queue.shift();
    if (!item) return;
    let vol = this.volume * item.volume;
    if (item.pos) {
      const d = this.distance(item.pos);
      if (d > this.maxDistance) return this.pump();
      vol *= Math.min(1, this.refDistance / (this.refDistance + 1.0 * Math.max(0, d - this.refDistance)));
    }
    if (vol < 0.05) return this.pump();
    const u = new SpeechSynthesisUtterance(item.text);
    let v = this.chosen[item.gender];
    let pitch = item.gender === 'female' ? 1.12 : 0.95;
    if (!v) {
      v = this.chosen[item.gender === 'male' ? 'female' : 'male'];
      pitch = item.gender === 'female' ? 1.35 : 0.75;
    }
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else {
      u.lang = 'en-IN';
    }
    u.volume = Math.min(1, vol);
    u.rate = 1.02 + Math.random() * 0.14;
    u.pitch = pitch * (0.94 + Math.random() * 0.12);
    this.current = u;
    this.currentPriority = item.priority;
    const done = (): void => {
      if (this.current !== u) return;
      window.clearTimeout(this.watchdog);
      this.current = null;
      this.lastEnd = performance.now();
      window.setTimeout(() => this.pump(), 140);
    };
    u.onend = done;
    u.onerror = done;
    // Some engines occasionally never fire onend; don't let the queue jam.
    this.watchdog = window.setTimeout(done, 1800 + item.text.length * 110);
    this.synth.speak(u);
  }
}
