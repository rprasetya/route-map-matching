import type { Candidate } from './candidates';
import { distance, type LngLat } from './geo';
import type { Network } from './network';

export interface Route {
  length: number;
  node: number;
}

export class Search {
  private readonly cost: Float64Array;
  private readonly parent: Int32Array;
  private readonly parentArc: Int32Array;
  private readonly reached: Uint32Array;
  private readonly settled: Uint32Array;
  private readonly wanted: Uint32Array;
  private epoch = 0;
  private heapCost = new Float64Array(256);
  private heapNode = new Int32Array(256);
  private heapSize = 0;
  private source: Candidate | null = null;
  private weighted = false;
  readonly route: Route = { length: Infinity, node: -1 };

  constructor(private readonly net: Network) {
    const n = net.nodeCount;
    this.cost = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.parentArc = new Int32Array(n);
    this.reached = new Uint32Array(n);
    this.settled = new Uint32Array(n);
    this.wanted = new Uint32Array(n);
  }

  private push(c: number, node: number): void {
    if (this.heapSize === this.heapCost.length) {
      const cost = new Float64Array(this.heapSize * 2);
      const nodes = new Int32Array(this.heapSize * 2);
      cost.set(this.heapCost);
      nodes.set(this.heapNode);
      this.heapCost = cost;
      this.heapNode = nodes;
    }
    const hc = this.heapCost;
    const hn = this.heapNode;
    let i = this.heapSize++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      const pc = hc[up];
      if (pc <= c) break;
      hc[i] = pc;
      hn[i] = hn[up];
      i = up;
    }
    hc[i] = c;
    hn[i] = node;
  }

  private popCost = 0;

  private pop(): number {
    const hc = this.heapCost;
    const hn = this.heapNode;
    const top = hn[0];
    this.popCost = hc[0];
    const last = --this.heapSize;
    if (last > 0) {
      const mc = hc[last];
      const mn = hn[last];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        let m = i;
        let vm = mc;
        if (l < last && hc[l] < vm) {
          m = l;
          vm = hc[l];
        }
        const r = l + 1;
        if (r < last && hc[r] < vm) {
          m = r;
          vm = hc[r];
        }
        if (m === i) break;
        hc[i] = vm;
        hn[i] = hn[m];
        i = m;
      }
      hc[i] = mc;
      hn[i] = mn;
    }
    return top;
  }

  private seed(node: number, c: number): void {
    if (this.reached[node] === this.epoch && c >= this.cost[node]) return;
    this.reached[node] = this.epoch;
    this.cost[node] = c;
    this.parent[node] = -1;
    this.parentArc[node] = -1;
    this.push(c, node);
  }

  run(from: Candidate, limit: number, weighted: boolean, targets: readonly Candidate[] | null): void {
    const net = this.net;
    if (++this.epoch === 0xffffffff) {
      this.reached.fill(0);
      this.settled.fill(0);
      this.wanted.fill(0);
      this.epoch = 1;
    }
    const epoch = this.epoch;
    this.source = from;
    this.weighted = weighted;
    this.heapSize = 0;
    let remaining = -1;
    if (targets) {
      remaining = 0;
      for (const t of targets) {
        for (const node of [net.edgeA[t.edge], net.edgeB[t.edge]]) {
          if (this.wanted[node] !== epoch) {
            this.wanted[node] = epoch;
            remaining += 1;
          }
        }
      }
    }
    const e = from.edge;
    const f = weighted ? net.edgeFactor[e] : 1;
    const length = net.edgeLength[e];
    this.seed(net.edgeA[e], from.t * length * f * net.edgeBackward[e]);
    this.seed(net.edgeB[e], (1 - from.t) * length * f * net.edgeForward[e]);
    const cost = this.cost;
    const reached = this.reached;
    const settled = this.settled;
    const arcStart = net.arcStart;
    const arcNode = net.arcNode;
    const arcCost = weighted ? net.arcWeight : net.arcDistance;
    while (this.heapSize > 0) {
      const n = this.pop();
      const c = this.popCost;
      if (settled[n] === epoch) continue;
      settled[n] = epoch;
      if (remaining >= 0) {
        if (this.wanted[n] === epoch) {
          this.wanted[n] = 0;
          remaining -= 1;
        }
        if (remaining === 0) break;
      }
      for (let i = arcStart[n], end = arcStart[n + 1]; i < end; i += 1) {
        const k = arcNode[i];
        const cb = c + arcCost[i];
        if (cb <= limit && (reached[k] !== epoch || cb < cost[k])) {
          reached[k] = epoch;
          cost[k] = cb;
          this.parent[k] = n;
          this.parentArc[k] = i;
          this.push(cb, k);
        }
      }
    }
  }

  costTo(node: number): number {
    return this.reached[node] === this.epoch ? this.cost[node] : Infinity;
  }

  routeTo(to: Candidate): Route {
    const net = this.net;
    const from = this.source!;
    const e = to.edge;
    const f = this.weighted ? net.edgeFactor[e] : 1;
    const forward = f * net.edgeForward[e];
    const backward = f * net.edgeBackward[e];
    const length = net.edgeLength[e];
    let best = Infinity;
    let node = -1;
    if (from.edge === e) best = Math.abs(to.t - from.t) * length * (to.t >= from.t ? forward : backward);
    const a = net.edgeA[e];
    const ca = this.costTo(a) + to.t * length * forward;
    if (ca < best) {
      best = ca;
      node = a;
    }
    const b = net.edgeB[e];
    const cb = this.costTo(b) + (1 - to.t) * length * backward;
    if (cb < best) {
      best = cb;
      node = b;
    }
    this.route.length = best;
    this.route.node = node;
    return this.route;
  }

  wrongWay(to: Candidate, node: number): boolean {
    const net = this.net;
    const from = this.source!;
    if (node < 0) return from.edge === to.edge && (to.t >= from.t ? net.edgeForward[from.edge] : net.edgeBackward[from.edge]) > 1;
    if ((node === net.edgeA[to.edge] ? net.edgeForward[to.edge] : net.edgeBackward[to.edge]) > 1) return true;
    let s = node;
    for (let p = this.parent[s]; p >= 0; s = p, p = this.parent[s]) {
      if (net.arcDistance[this.parentArc[s]] > distance(net.nodeLng[p], net.nodeLat[p], net.nodeLng[s], net.nodeLat[s]) * 1.5) return true;
    }
    return (s === net.edgeA[from.edge] ? net.edgeBackward[from.edge] : net.edgeForward[from.edge]) > 1;
  }

  path(node: number): LngLat[] {
    const net = this.net;
    const out: LngLat[] = [];
    for (let s = node; s >= 0; s = this.parent[s]) out.push({ lng: net.nodeLng[s], lat: net.nodeLat[s] });
    return out.reverse();
  }

  pathNodes(node: number): Int32Array {
    let count = 0;
    for (let s = node; s >= 0; s = this.parent[s]) count += 1;
    const out = new Int32Array(count);
    for (let s = node, i = count - 1; s >= 0; s = this.parent[s], i -= 1) out[i] = s;
    return out;
  }
}
