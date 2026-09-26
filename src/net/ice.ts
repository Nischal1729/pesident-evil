/**
 * WebRTC connection settings (ICE servers). STUN lets two browsers find each other's public address, which is enough
 * on friendly networks. Behind carrier-grade or symmetric NAT (common on mobile data, Jio / Airtel fibre, campus
 * Wi-Fi) no direct path exists and traffic must go through a TURN relay, which needs an account with a provider.
 * The relay comes from build-time settings (GitHub repository secrets in the Pages workflow, or a local .env.local):
 *
 *   VITE_TURN_URLS        comma-separated, e.g. turn:relay1.expressturn.com:3478,turn:relay1.expressturn.com:3478?transport=tcp
 *   VITE_TURN_USERNAME    static credentials (ExpressTURN free plan and the like)
 *   VITE_TURN_CREDENTIAL
 *   VITE_TURN_ENDPOINT    or: a URL returning {"iceServers": [...]} with short-lived credentials (a Cloudflare Worker
 *                         in front of Cloudflare TURN, Metered's credentials API)
 *
 * PeerJS's built-in relays (eu-0 / us-0.turn.peerjs.com) no longer answer (checked 2026-09-26), so they're not used.
 */
const STUN: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export interface IceConfig { servers: RTCIceServer[]; relay: boolean }

let cached: { at: number; cfg: IceConfig } | null = null;

export async function iceConfig(): Promise<IceConfig> {
  // endpoint credentials are short-lived; reuse them for a while only
  if (cached && performance.now() - cached.at < 30 * 60 * 1000) return cached.cfg;
  const env = import.meta.env as Record<string, string | undefined>;
  const servers: RTCIceServer[] = [...STUN];
  let relay = false;
  const urls = env.VITE_TURN_URLS?.split(',').map((u) => u.trim()).filter(Boolean);
  if (urls?.length) {
    servers.push({ urls, username: env.VITE_TURN_USERNAME ?? '', credential: env.VITE_TURN_CREDENTIAL ?? '' });
    relay = true;
  }
  if (env.VITE_TURN_ENDPOINT) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      const res = await fetch(env.VITE_TURN_ENDPOINT, { signal: ctl.signal });
      clearTimeout(t);
      const data = (await res.json()) as { iceServers?: RTCIceServer | RTCIceServer[] };
      const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
      // drop port-53 entries: browsers block them and they only stall gathering
      for (const s of list) {
        const u = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((x) => !/:53(\?|$)/.test(x));
        if (u.length) servers.push({ ...s, urls: u });
      }
      relay ||= list.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((x) => x.startsWith('turn')));
    } catch (e) {
      console.warn('[net] TURN credentials endpoint failed; direct connections only', e);
    }
  }
  const cfg = { servers, relay };
  cached = { at: performance.now(), cfg };
  return cfg;
}

/** How an open connection is routed: 'direct' (host / STUN pair), 'relay' (through TURN), or 'unknown'. */
export async function routeOf(pc: RTCPeerConnection | null | undefined): Promise<'direct' | 'relay' | 'unknown'> {
  if (!pc) return 'unknown';
  try {
    const stats = await pc.getStats();
    let pair: { localCandidateId?: string; remoteCandidateId?: string } | null = null;
    stats.forEach((r) => {
      if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId) ?? pair;
    });
    if (!pair) stats.forEach((r) => { if (r.type === 'candidate-pair' && (r.selected || (r.nominated && r.state === 'succeeded'))) pair = r; });
    if (!pair) return 'unknown';
    const p = pair as { localCandidateId?: string; remoteCandidateId?: string };
    const l = p.localCandidateId ? stats.get(p.localCandidateId) : null;
    const r = p.remoteCandidateId ? stats.get(p.remoteCandidateId) : null;
    return l?.candidateType === 'relay' || r?.candidateType === 'relay' ? 'relay' : 'direct';
  } catch {
    return 'unknown';
  }
}
