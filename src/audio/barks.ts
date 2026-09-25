/**
 * NPC barks via the Web Speech API.
 *
 * speechSynthesis cannot be routed through WebAudio, so it can't be spatialised: we
 * approximate by scaling utterance volume with distance to the listener and skipping
 * barks that are too far away.
 *
 * Voice preference, per gender, is en-IN first, then other Indian locales, then any
 * English voice (see `score`):
 *   male:   Rishi or any en-IN male (macOS "Rishi", Windows "Ravi", Edge "Prabhat").
 *   female: an en-IN female if one is installed (Veena, Heera, Neerja, ...), else an
 *           hi-IN voice (macOS "Lekha" reads English passably), else any other
 *           Indian-locale voice (kn/ta/te-IN, e.g. macOS "Vani"), else natural English.
 * A kn-IN voice scores with the other Indian locales rather than above en-IN: we have
 * no installed Kannada voice to confirm it reads Latin-script English rather than
 * transliterating into Kannada script.
 */

export const BARKS = {
  reloading: [
    'Reloading, cover me macha!',
    'One minute, changing mag!',
    'Reloading! Ask him to cover me, guru!',
    'Out! Reloading, reloading!',
    'Give me two seconds da, mag empty!',
    'Cover me yaar, mag is empty only!',
    "Don't come near, I am reloading!",
    'Reloading. Slower than hostel Wi-Fi, no?',
  ],
  spotted: [
    'They are coming, coming, through the main gate!',
    'Zombies near the food court, full crowd there!',
    'Contact! Near GJB, come fast!',
    'What da, more of them on Ring Road!',
    'Sprinter! Sprinter coming fast!',
    'Behind you, maga!',
    'Big group coming, get ready fast!',
    'They are near the library only, careful!',
    'Aiyyo, look at that crowd. Worse than Silk Board!',
  ],
  hurt: [
    'I am hurt, I am hurt!',
    'Aiyyo! It bit me!',
    'Need a medkit, fast!',
    'Ah! That one got me, no?',
    'I am bleeding here, macha!',
    "Help me guru, I'm going down!",
    'Ow! Get it off me!',
  ],
  kill: [
    'Sorted, no?',
    'One down, guru!',
    'Sakkath shot!',
    'Bombat! Got him!',
    'Stay down, da!',
    'One less for the attendance register, only.',
    'Attendance shortage. Detained!',
    'Down he goes, simply.',
    'Headshot, maga!',
  ],
  revive: [
    'Get up da, get up!',
    "Hold on, I've got you!",
    "Don't you dare die before ESA, macha!",
    'Up, up! Back on your feet!',
    'Stay with me, guru. One minute!',
    "Come on, I'm not submitting your assignment for you!",
    'Easy, easy, I am helping you up only.',
  ],
  downed: [
    'I am down! Somebody help!',
    'Macha, I am down! Revive me, no?',
    "Can't get up, help yaar!",
    'Aiyyo, I am down, I am down!',
    'Tell my amma I tried to study, only.',
    'Need a hand here, guru. Come fast!',
    'Somebody pick me up, please. One minute!',
  ],
  waveClear: [
    "Is it over? Please tell me it's over, no?",
    'Worse than ESA week, this.',
    'Phew! Somebody get me filter coffee, fast.',
    "Sorted! That's the wave only, guys.",
    'Bombat, we survived!',
    'Okay, simply breathe. Everybody still here?',
    "I'd rather write three back-to-back exams than do that again.",
    'Canteen break, one minute, then we go again.',
  ],
  waveStart: [
    'Here they come again, full crowd!',
    "That's the bell! Everyone to positions, fast!",
    'Next period starts now, guys!',
    'Get ready, macha, they are coming, coming!',
    'Main gate! Hold the main gate, no?',
    'Chalo, chalo, positions only!',
    "Arre, didn't this class just end?",
    'Ring Road is full of them, get ready fast!',
  ],
  lowAmmo: [
    'Running low on ammo, only!',
    'Almost out, anyone have spare mags?',
    'Last mag, macha!',
    'Ammo, ammo! I need ammo, fast!',
    'Few rounds left, yaar. Simply manage!',
    'Need to find an ammo crate, fast!',
    'Swalpa ammo kodi, anyone?',
  ],
  thanks: [
    'Thanks, macha!',
    'Thank you, guru. Owe you one, no?',
    'Nice save, da!',
    'Lifesaver! Canteen treat on me.',
    'Sakkath! Thanks only!',
    'You are the best, yaar. Simply.',
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
  /** Speaker's name (any casing/suffix, e.g. "Rahul (CSE, 3rd yr)"); looked up in CHARACTER_TUNING. */
  character?: string;
  position?: { x: number; y: number; z: number };
  /** Higher priority barks jump the queue and may interrupt a lower one (default 1). */
  priority?: number;
  /** Extra per-line volume multiplier. */
  volume?: number;
}

/**
 * Per-character rate/pitch multipliers, applied on top of the gender base pitch, so
 * squadmates don't all sound alike on a single installed voice per gender. Keyed by
 * the first word of `SayOptions.character`, lowercased.
 */
export const CHARACTER_TUNING: Record<string, { rate: number; pitch: number }> = {
  rahul: { rate: 1.0, pitch: 1.0 },
  ananya: { rate: 1.06, pitch: 1.06 },
  manjunath: { rate: 0.88, pitch: 0.84 },
};

function tuningFor(character: string | undefined): { rate: number; pitch: number } | undefined {
  const key = character?.match(/[a-z]+/i)?.[0]?.toLowerCase();
  return key ? CHARACTER_TUNING[key] : undefined;
}

interface QueuedBark {
  text: string;
  gender: VoiceGender;
  tuning?: { rate: number; pitch: number };
  pos?: { x: number; y: number; z: number };
  priority: number;
  volume: number;
  at: number;
}

const IN_MALE = ['rishi', 'ravi', 'prabhat', 'hemant', 'aarav', 'arjun', 'kunal', 'madhur', 'kumar', 'raj'];
const IN_FEMALE = ['veena', 'heera', 'neerja', 'isha', 'lekha', 'kalpana', 'aditi', 'raveena', 'sangeeta', 'kajal', 'swara', 'ananya', 'priya', 'pallavi', 'vani', 'soumya'];
const EN_MALE = ['daniel', 'alex', 'fred', 'tom', 'aaron', 'arthur', 'oliver', 'gordon', 'lee', 'reed', 'eddy', 'guy', 'david', 'mark', 'george', 'james', 'ryan', 'thomas', 'rocko', 'grandpa', 'evan', 'nathan'];
const EN_FEMALE = ['samantha', 'victoria', 'karen', 'moira', 'tessa', 'fiona', 'serena', 'kate', 'susan', 'zira', 'allison', 'ava', 'nicky', 'martha', 'catherine', 'hazel', 'libby', 'sonia', 'jenny', 'aria', 'emma', 'flo', 'sandy', 'shelley', 'grandma', 'zoe', 'joelle', 'kathy'];
const NOVELTY = ['bad news', 'bells', 'boing', 'bubbles', 'cellos', 'deranged', 'good news', 'hysterical', 'pipe organ', 'trinoids', 'whisper', 'zarvox', 'albert', 'bahh', 'jester', 'organ', 'superstar', 'wobble', 'junior', 'ralph'];
/** macOS "Eloquence" voices: understandable but robotic. */
const ROBOTIC = ['eddy', 'flo', 'grandma', 'grandpa', 'reed', 'rocko', 'sandy', 'shelley', 'fred', 'kathy'];
/** Natural-sounding fallbacks when no en-IN voice of the wanted gender is installed. */
const NATURAL: Record<string, number> = { samantha: 8, daniel: 8, karen: 6, moira: 6, tessa: 6, serena: 6, arthur: 5, oliver: 5, kate: 4, catherine: 3 };

/**
 * Locale preference tier: en-IN, then hi-IN (Lekha reads English fine), then the
 * other Indian locales we might see installed (kn/ta/te-IN, e.g. Vani, Soumya),
 * then any other English voice. Non-English, non-Indian voices are disqualified.
 */
function localeTier(v: SpeechSynthesisVoice): number {
  const l = v.lang.replace('_', '-').toLowerCase();
  if (l.startsWith('en-in')) return 3;
  if (l.startsWith('hi-in')) return 2;
  if (/^(kn|ta|te)-in/.test(l)) return 1;
  if (l.startsWith('en')) return 0;
  return -1;
}
/** Voices whose names carry no gender hint. Chrome ships "Google हिन्दी" (a female voice) on every desktop OS. */
const KNOWN_GENDER: Record<string, VoiceGender> = { 'google हिन्दी': 'female' };

function genderOf(v: SpeechSynthesisVoice): VoiceGender | null {
  const n = v.name.toLowerCase();
  if (KNOWN_GENDER[n]) return KNOWN_GENDER[n];
  if (n.includes('female')) return 'female';
  if (/\bmale\b/.test(n)) return 'male';
  if (IN_FEMALE.some((k) => n.includes(k)) || EN_FEMALE.some((k) => n.includes(k))) return 'female';
  if (IN_MALE.some((k) => n.includes(k)) || EN_MALE.some((k) => n.includes(k))) return 'male';
  return null;
}

function score(v: SpeechSynthesisVoice, want: VoiceGender): number {
  const n = v.name.toLowerCase();
  const tier = localeTier(v);
  if (tier < 0) return -1000;
  const g = genderOf(v);
  // a non-English Indian voice only beats English when it is known to be the wanted gender: its tier bonus (up to
  // 60) otherwise outscores every English voice, and an unknown-gender one would take the male slot too
  if ((tier === 1 || tier === 2) && g !== want) return -1000;
  let s = tier * 30;
  if (NOVELTY.some((k) => n.includes(k))) s -= 200;
  if (ROBOTIC.some((k) => n.startsWith(k))) s -= 15;
  for (const [k, bonus] of Object.entries(NATURAL)) if (n.startsWith(k)) s += bonus;
  if (g === want) s += 40;
  else if (g !== null) s -= 60;
  if (v.localService) s += 5;
  if (n.includes('premium') || n.includes('enhanced') || n.includes('natural')) s += 8;
  return s;
}

/** Pure voice selection, kept separate from Barker so it's testable without a real SpeechSynthesis. */
export function pickVoices(voices: readonly SpeechSynthesisVoice[]): Record<VoiceGender, SpeechSynthesisVoice | null> {
  const chosen: Record<VoiceGender, SpeechSynthesisVoice | null> = { male: null, female: null };
  for (const g of ['male', 'female'] as const) {
    let best: SpeechSynthesisVoice | null = null;
    let bs = -Infinity;
    for (const v of voices) {
      const s = score(v, g);
      if (s > bs) {
        bs = s;
        best = v;
      }
    }
    chosen[g] = bs > -100 ? best : null;
  }
  return chosen;
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
    this.chosen = pickVoices(this.voices);
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
      tuning: tuningFor(opts.character),
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
    u.rate = (item.tuning?.rate ?? 1) * (1.02 + Math.random() * 0.14);
    u.pitch = pitch * (item.tuning?.pitch ?? 1) * (0.94 + Math.random() * 0.12);
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
