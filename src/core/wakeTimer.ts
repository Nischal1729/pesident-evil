/**
 * setInterval that keeps its rate in a background tab. Browsers throttle a hidden page's timers (Chrome: chained timers
 * fire at most once a minute after five minutes hidden); a dedicated worker's timers aren't, so a tiny worker posts
 * the ticks. Falls back to setInterval where workers can't be created.
 */
export function wakeInterval(ms: number, fn: () => void): () => void {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${Math.max(4, Math.round(ms))});`], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = () => fn();
    return () => { worker.terminate(); URL.revokeObjectURL(url); };
  } catch {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}
