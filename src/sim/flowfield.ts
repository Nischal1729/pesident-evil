/**
 * Dial's-algorithm flow field on a uniform grid (costs: 10 straight, 14 diagonal, + gate penalty).
 * Pure function so it can run inside a Web Worker or on the main thread.
 * grid: 0 free, 1 blocked, 2 gate cell. gateIdx: gate index per cell (-1). gateClosed[i]: gate i intact.
 */
export const INF = 0xffffffff;
export const GATE_PENALTY = 260;

export function computeFlowField(
  w: number, h: number, grid: Uint8Array, gateIdx: Int8Array, gateClosed: ArrayLike<number>,
  targets: ArrayLike<number>, out: Uint32Array, maxCost = 60000,
): void {
  out.fill(INF);
  const NB = 512; // ring of buckets, > max edge cost (14 + penalty)
  const buckets: Int32Array[] = [];
  const sizes = new Int32Array(NB);
  for (let i = 0; i < NB; i++) buckets.push(new Int32Array(256));
  const push = (cost: number, idx: number) => {
    const b = cost % NB;
    let arr = buckets[b];
    if (sizes[b] >= arr.length) {
      const n = new Int32Array(arr.length * 2);
      n.set(arr);
      buckets[b] = arr = n;
    }
    arr[sizes[b]++] = idx;
  };
  let pending = 0;
  for (let t = 0; t < targets.length; t += 2) {
    const cx = Math.floor(targets[t]), cz = Math.floor(targets[t + 1]);
    if (cx < 0 || cz < 0 || cx >= w || cz >= h) continue;
    const idx = cz * w + cx;
    if (out[idx] === 0) continue;
    out[idx] = 0;
    push(0, idx);
    pending++;
  }
  let cost = 0;
  let emptyRun = 0;
  while (pending > 0 && cost <= maxCost) {
    const b = cost % NB;
    if (sizes[b] === 0) {
      cost++;
      if (++emptyRun > NB) break;
      continue;
    }
    emptyRun = 0;
    // process bucket (it may grow while we iterate if an edge of cost 0 existed — none here)
    const arr = buckets[b];
    const n = sizes[b];
    sizes[b] = 0;
    for (let k = 0; k < n; k++) {
      const idx = arr[k];
      pending--;
      if (out[idx] !== cost) continue; // stale
      const x = idx % w, z = (idx - x) / w;
      for (let dz = -1; dz <= 1; dz++) {
        const nz = z + dz;
        if (nz < 0 || nz >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const ni = nz * w + nx;
          const g = grid[ni];
          if (g === 1) continue;
          let step = 10;
          if (dx !== 0 && dz !== 0) {
            // no corner cutting
            if (grid[z * w + nx] === 1 || grid[nz * w + x] === 1) continue;
            step = 14;
          }
          if (g === 2) {
            const gi = gateIdx[ni];
            if (gi >= 0 && gateClosed[gi]) step += GATE_PENALTY;
          }
          const nc = cost + step;
          if (nc < out[ni]) {
            out[ni] = nc;
            push(nc, ni);
            pending++;
          }
        }
      }
    }
    cost++;
  }
}

/**
 * Dial's-algorithm flow field over a layered navigation graph (multi-level): nodes are walkable surfaces (several
 * per 1 m cell where floors stack). Costs spread along REVERSED edges — rStart/rList/rCost is the CSR list of each
 * node's predecessors (m with an edge m→n, cost 10 straight / 14 diagonal) — so that a body at m always finds a
 * lower-cost node among its own forward edges (the graph is not symmetric where surfaces of different heights meet).
 * nodeGate[n] = gate index (−1): passing through a closed gate costs GATE_PENALTY.
 */
export function computeGraphField(
  n: number, rStart: Int32Array, rList: Int32Array, rCost: Uint8Array, nodeGate: Int8Array, gateClosed: ArrayLike<number>,
  targets: ArrayLike<number>, out: Uint32Array, maxCost = 60000,
): void {
  out.fill(INF);
  const NB = 512;
  const buckets: Int32Array[] = [];
  const sizes = new Int32Array(NB);
  for (let i = 0; i < NB; i++) buckets.push(new Int32Array(256));
  const push = (cost: number, idx: number) => {
    const b = cost % NB;
    let arr = buckets[b];
    if (sizes[b] >= arr.length) {
      const nn = new Int32Array(arr.length * 2);
      nn.set(arr);
      buckets[b] = arr = nn;
    }
    arr[sizes[b]++] = idx;
  };
  let pending = 0;
  for (let t = 0; t < targets.length; t++) {
    const idx = targets[t];
    if (idx < 0 || idx >= n || out[idx] === 0) continue;
    out[idx] = 0;
    push(0, idx);
    pending++;
  }
  let cost = 0, emptyRun = 0;
  while (pending > 0 && cost <= maxCost) {
    const b = cost % NB;
    if (sizes[b] === 0) {
      cost++;
      if (++emptyRun > NB) break;
      continue;
    }
    emptyRun = 0;
    const arr = buckets[b];
    const cnt = sizes[b];
    sizes[b] = 0;
    for (let k = 0; k < cnt; k++) {
      const idx = arr[k];
      pending--;
      if (out[idx] !== cost) continue;
      for (let e = rStart[idx]; e < rStart[idx + 1]; e++) {
        const m = rList[e];
        let step = rCost[e];
        const gi = nodeGate[m];
        if (gi >= 0 && gateClosed[gi]) step += GATE_PENALTY;
        const nc = cost + step;
        if (nc < out[m]) {
          out[m] = nc;
          push(nc, m);
          pending++;
        }
      }
    }
    cost++;
  }
}
