import { computeFlowField } from './flowfield';

let W = 0, H = 0;
let grid: Uint8Array | null = null;
let gateIdx: Int8Array | null = null;
let gateClosed: Uint8Array = new Uint8Array(8);

const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown, t?: Transferable[]) => void };
ctx.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') {
    W = m.w; H = m.h; grid = m.grid; gateIdx = m.gateIdx;
  } else if (m.type === 'gates') {
    gateClosed = m.closed;
  } else if (m.type === 'compute' && grid && gateIdx) {
    const out = new Uint32Array(m.buffer as ArrayBuffer);
    computeFlowField(W, H, grid, gateIdx, gateClosed, m.targets, out, m.maxCost ?? 60000);
    ctx.postMessage({ type: 'field', kind: m.kind, id: m.id, buffer: out.buffer }, [out.buffer]);
  }
};
