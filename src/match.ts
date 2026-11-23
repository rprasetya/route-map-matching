import { CandidateFinder, type Candidate, type Heading } from './candidates';
import {
  BAD_M,
  BETA_M,
  BREAK_M,
  DETOUR_EXTRA_M,
  DETOUR_FACTOR,
  GAP_EXTRA_M,
  GAP_FACTOR,
  GAP_MAX_M,
  GAP_MIN_M,
  GAP_SNAPPED_EXTRA_M,
  GAP_SNAPPED_FACTOR,
  HEADING_CONFIDENT_M,
  HEADING_MIN_M,
  HOOK_M,
  HOOK_NODES,
  JITTER_M,
  LOOKAHEAD_M,
  MAX_SKIPPED,
  MIN_CHAIN,
  RAD,
  RADIUS_M,
  REVERSAL_M,
  SIGMA_M,
  STRAIGHTEN_MAX_M,
  STRAIGHTEN_SAVING,
  STRAIGHTEN_SAVING_M,
  STRAIGHTEN_WEIGHT_MAX,
  TOLERANCE_FACTOR,
  TOLERANCE_MAX_M,
  TOLERANCE_MIN_M,
  UNMATCHED_ERROR_M,
  WEIGHT_FACTOR_MAX,
  WIDE_RADII_M,
} from './constants';
import { distance, distanceOf, lineLength, project, reverses, type LngLat, type Position } from './geo';
import type { Network } from './network';
import { Search } from './search';
import { isLeftHandTraffic } from './traffic-side';

export type PointFlags = boolean | ((index: number) => boolean) | readonly boolean[];

export interface MatchOptions {
  radius?: number;
  include?: PointFlags;
  leftHandTraffic?: PointFlags | 'auto';
}

export interface MatchedPoint {
  index: number;
  position: LngLat;
  path: LngLat[];
  skipped: boolean;
  matched: boolean;
}

interface State {
  m: Candidate;
  cost: number;
  from: number;
  prev: number;
  node: number;
  route: Int32Array | null;
}

interface Draft {
  index: number;
  position: LngLat;
  path: LngLat[];
  skipped: boolean;
  matched: boolean;
  m: Candidate | null;
}

interface Tools {
  finder: CandidateFinder;
  search: Search;
}

const tools = new WeakMap<Network, Tools>();

function toolsFor(net: Network): Tools {
  let t = tools.get(net);
  if (!t) {
    t = { finder: new CandidateFinder(net), search: new Search(net) };
    tools.set(net, t);
  }
  return t;
}

const flag = (value: PointFlags | undefined, fallback: boolean): ((index: number) => boolean) => {
  if (value === undefined) return () => fallback;
  if (typeof value === 'boolean') return () => value;
  if (typeof value === 'function') return value;
  return (i) => (value[i] === undefined ? fallback : value[i] !== false);
};

const emission = (m: Candidate): number => {
  const r = m.score / SIGMA_M;
  return (r * r) / 2;
};

const startChain = (cands: Candidate[]): State[] => cands.map((m) => ({ m, cost: emission(m), from: -1, prev: -1, node: -1, route: null }));

function trimSpikes(start: LngLat, path: readonly LngLat[], end: LngLat): LngLat[] {
  const pts: LngLat[] = [start, ...path, end];
  for (let i = 1; i < pts.length - 1; ) {
    if (reverses(pts[i - 1], pts[i], pts[i + 1])) {
      pts.splice(i, 1);
      i = Math.max(1, i - 1);
    } else i += 1;
  }
  for (let i = 0; i < pts.length - 2; i += 1) {
    let walked = 0;
    const stop = Math.min(pts.length, i + 1 + HOOK_NODES);
    for (let j = i + 1; j < stop; j += 1) {
      walked += distanceOf(pts[j - 1], pts[j]);
      if (j > i + 1) {
        const gap = distanceOf(pts[i], pts[j]);
        if (gap < HOOK_M && walked > gap * 3 + HOOK_M) {
          pts.splice(i + 1, j - i - 1);
          break;
        }
      }
    }
  }
  return pts.slice(1, -1);
}

const at = (c: Candidate): LngLat => ({ lng: c.lng, lat: c.lat });

function lengthThrough(start: LngLat, path: readonly LngLat[], end: LngLat): number {
  let total = 0;
  let prev = start;
  for (let i = 0; i < path.length; i += 1) {
    const q = path[i];
    total += distance(prev.lng, prev.lat, q.lng, q.lat);
    prev = q;
  }
  return total + distance(prev.lng, prev.lat, end.lng, end.lat);
}

export function matchPoints(input: readonly LngLat[], network: Network, options: MatchOptions = {}): MatchedPoint[] {
  const n = input.length;
  if (n === 0) return [];
  const radius = options.radius ?? RADIUS_M;
  const include = flag(options.include, true);
  const { finder, search } = toolsFor(network);
  const pts: LngLat[] = input.map((p) => ({ lng: p.lng, lat: p.lat }));
  const side = options.leftHandTraffic ?? 'auto';
  const leftHand = side === 'auto' ? flag(pts.map((p) => isLeftHandTraffic(p.lng, p.lat)), false) : flag(side, false);
  const cos = new Float64Array(n);
  const step = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    cos[i] = Math.cos(pts[i].lat * RAD);
    if (i > 0) step[i] = distanceOf(pts[i - 1], pts[i]);
  }
  const heading: Heading = { x: 0, y: 0 };

  const layers: State[][] = [];
  let last = -1;
  for (let i = 0; i < n; i += 1) {
    const p = pts[i];
    if (!include(i)) {
      layers.push([]);
      last = -1;
      continue;
    }
    const from = i > 0 ? pts[i - 1] : p;
    const to = i > 0 ? p : pts[1];
    const length = to ? distanceOf(from, to) : 0;
    let dir: Heading | null = null;
    if (length >= HEADING_MIN_M) {
      const c = Math.cos(((from.lat + to.lat) / 2) * RAD);
      const dx = (to.lng - from.lng) * c;
      const dy = to.lat - from.lat;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        heading.x = dx / len;
        heading.y = dy / len;
        dir = heading;
      }
    }
    const left = leftHand(i);
    const confident = length >= HEADING_CONFIDENT_M;
    let cands = finder.find(p.lng, p.lat, cos[i], dir, radius, left, confident);
    for (const r of WIDE_RADII_M) {
      if (cands.length || r <= radius) break;
      cands = finder.find(p.lng, p.lat, cos[i], dir, r, left, confident);
    }
    if (!cands.length) {
      layers.push([]);
      if (last >= 0 && i - last > MAX_SKIPPED) last = -1;
      continue;
    }
    if (last < 0) {
      layers.push(startChain(cands));
      last = i;
      continue;
    }
    let straight = 0;
    for (let j = last + 1; j <= i; j += 1) straight += step[j];
    if (straight > BREAK_M) {
      layers.push(startChain(cands));
      last = i;
      continue;
    }
    const before = layers[last];
    const limit = Math.max(straight * DETOUR_FACTOR, straight + DETOUR_EXTRA_M);
    const best: (State | null)[] = new Array(cands.length).fill(null);
    for (let j = 0; j < before.length; j += 1) {
      const s = before[j];
      search.run(s.m, limit, false, cands);
      for (let c = 0; c < cands.length; c += 1) {
        const m = cands[c];
        const r = search.routeTo(m);
        if (r.length > limit) continue;
        const cost = s.cost + Math.abs(r.length - straight) / BETA_M + emission(m);
        const cur = best[c];
        if (cur === null || cost < cur.cost) {
          const node = r.node;
          best[c] = { m, cost, from: last, prev: j, node, route: node >= 0 ? search.pathNodes(node) : null };
        }
      }
    }
    const row: State[] = [];
    for (const s of best) if (s !== null) row.push(s);
    layers.push(row.length ? row : startChain(cands));
    last = i;
  }

  const chosen: (State | null)[] = new Array(n).fill(null);
  const skipped = new Uint8Array(n);
  for (let i = n - 1; i >= 0; ) {
    const layer = layers[i];
    if (!layer.length) {
      i -= 1;
      continue;
    }
    let idx = 0;
    for (let j = 1; j < layer.length; j += 1) if (layer[j].cost < layer[idx].cost) idx = j;
    for (;;) {
      const s = layers[i][idx];
      chosen[i] = s;
      if (s.from < 0) break;
      for (let j = s.from + 1; j < i; j += 1) skipped[j] = 1;
      idx = s.prev;
      i = s.from;
    }
    i -= 1;
  }

  const chain = new Int32Array(n).fill(-1);
  const chainSize: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const s = chosen[i];
    if (!s) continue;
    if (s.from >= 0) {
      chain[i] = chain[s.from];
      for (let j = s.from + 1; j < i; j += 1) chain[j] = chain[i];
    } else {
      chain[i] = chainSize.length;
      chainSize.push(0);
    }
    chainSize[chain[i]] += 1;
  }
  for (let i = 0; i < n; i += 1) {
    if (chain[i] < 0 || chainSize[chain[i]] >= MIN_CHAIN) continue;
    chosen[i] = null;
    skipped[i] = 0;
  }

  const nodePoints = (nodes: Int32Array): LngLat[] => {
    const out: LngLat[] = new Array(nodes.length);
    for (let k = 0; k < nodes.length; k += 1) out[k] = { lng: network.nodeLng[nodes[k]], lat: network.nodeLat[nodes[k]] };
    return out;
  };
  const inserted: LngLat[][] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const s = chosen[i];
    inserted[i] = s && s.from >= 0 && s.node >= 0 ? trimSpikes(chosen[s.from]!.m, nodePoints(s.route!), s.m) : [];
  }

  const rawLength = (p: number, q: number): number => {
    let total = 0;
    for (let j = p + 1; j <= q; j += 1) total += step[j];
    return total;
  };

  const fillGap = (p: number, q: number): void => {
    const raw = rawLength(p, q);
    const start = chosen[p]!.m;
    const end = chosen[q]!.m;
    const snapped = distanceOf(start, end);
    if ((q === p + 1 && raw < GAP_MIN_M && snapped < GAP_MIN_M) || raw > GAP_MAX_M) return;
    const limit = Math.max(raw * GAP_FACTOR + GAP_EXTRA_M, snapped * GAP_SNAPPED_FACTOR + GAP_SNAPPED_EXTRA_M);
    search.run(start, limit * WEIGHT_FACTOR_MAX, true, [end]);
    const r = search.routeTo(end);
    if (!Number.isFinite(r.length)) return;
    const path = r.node >= 0 ? search.path(r.node) : [];
    if (lengthThrough(start, path, end) > limit) return;
    for (let j = p + 1; j < q; j += 1) skipped[j] = 1;
    inserted[q] = trimSpikes(start, path, end);
  };

  const connected = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) connected[i] = chosen[i] !== null && chosen[i]!.from >= 0 ? 1 : 0;
  const connect = (): void => {
    let prev = -1;
    for (let q = 0; q < n; q += 1) {
      if (!include(q)) {
        prev = -1;
        continue;
      }
      if (!chosen[q] || skipped[q]) continue;
      if (prev >= 0 && !connected[q]) {
        fillGap(prev, q);
        connected[q] = 1;
      }
      prev = q;
    }
  };
  connect();
  for (let i = 0; i < n; i += 1) {
    if (!include(i) || chosen[i] || skipped[i]) continue;
    const p = pts[i];
    for (const r of [radius, ...WIDE_RADII_M]) {
      const [m] = finder.find(p.lng, p.lat, cos[i], null, r);
      if (!m) continue;
      chosen[i] = { m, cost: 0, from: -1, prev: -1, node: -1, route: null };
      break;
    }
  }
  connect();

  let nearSegment = 1;
  const nearLine = (k: number, line: readonly LngLat[], tolerance: number): boolean => {
    const p = pts[k];
    const count = line.length;
    const start = nearSegment < count ? nearSegment : 1;
    for (let scan = 0, j = start; scan < count - 1; scan += 1, j = j + 1 < count ? j + 1 : 1) {
      if (project(p.lng, p.lat, cos[k], line[j - 1].lng, line[j - 1].lat, line[j].lng, line[j].lat).d <= tolerance) {
        nearSegment = j;
        return true;
      }
    }
    return false;
  };
  const snapDistance = new Float64Array(n);
  for (let k = 0; k < n; k += 1) {
    const s = chosen[k];
    if (s) snapDistance[k] = distanceOf(pts[k], s.m);
  }
  const error = (k: number): number => (chosen[k] && !skipped[k] ? snapDistance[k] : UNMATCHED_ERROR_M);
  const badState = new Uint8Array(n);
  const bad = (k: number): boolean => {
    const cached = badState[k];
    if (cached) return cached === 2;
    const s = chosen[k];
    let result: boolean;
    if (!s || skipped[k]) result = true;
    else if (snapDistance[k] > BAD_M) result = true;
    else if (s.from < 0 || !chosen[s.from]) result = false;
    else result = lengthThrough(chosen[s.from]!.m, inserted[k], s.m) > distanceOf(pts[s.from], pts[k]) * 1.5 + BAD_M;
    badState[k] = result ? 2 : 1;
    return result;
  };
  const next = (i: number): number => {
    for (let k = i + 1; k < n; k += 1) if (include(k) && chosen[k] && !skipped[k]) return k;
    return -1;
  };

  for (let i = next(-1); i >= 0; ) {
    let hasBad = false;
    let ahead = 0;
    for (let k = i + 1; k < n && include(k); k += 1) {
      ahead += step[k];
      if (ahead > LOOKAHEAD_M) break;
      if (bad(k)) {
        hasBad = true;
        break;
      }
    }
    if (!hasBad) {
      i = next(i);
      continue;
    }
    let windowLength = 0;
    const targets: Candidate[] = [];
    for (let k = i + 1; k < n && include(k); k += 1) {
      windowLength += step[k];
      if (windowLength > STRAIGHTEN_MAX_M) break;
      if (chosen[k] && !skipped[k]) targets.push(chosen[k]!.m);
    }
    const origin = chosen[i]!.m;
    search.run(origin, Math.min(STRAIGHTEN_WEIGHT_MAX, Math.min(windowLength, STRAIGHTEN_MAX_M) * 2 + 300), true, targets);
    let bestJ = -1;
    let bestPath: LngLat[] = [];
    let raw = 0;
    let currentLength = 0;
    let currentLast: LngLat = origin;
    let errorTotal = 0;
    for (let j = i + 1; j < n; j += 1) {
      if (!include(j)) break;
      raw += step[j];
      if (raw > STRAIGHTEN_MAX_M) break;
      if (j > i + 1) errorTotal += error(j - 1);
      if (!skipped[j]) {
        const sj = chosen[j];
        if (sj) {
          const ins = inserted[j];
          for (let q = 0; q < ins.length; q += 1) {
            currentLength += distance(currentLast.lng, currentLast.lat, ins[q].lng, ins[q].lat);
            currentLast = ins[q];
          }
          currentLength += distance(currentLast.lng, currentLast.lat, sj.m.lng, sj.m.lat);
          currentLast = sj.m;
        } else {
          currentLength += distance(currentLast.lng, currentLast.lat, pts[j].lng, pts[j].lat);
          currentLast = pts[j];
        }
      }
      const target = chosen[j];
      if (!target || skipped[j] || j === i + 1) continue;
      const r = search.routeTo(target.m);
      const node = r.node;
      if (!Number.isFinite(r.length) || search.wrongWay(target.m, node)) continue;
      const path = node >= 0 ? search.path(node) : [];
      if (currentLength < lengthThrough(origin, path, target.m) * STRAIGHTEN_SAVING + STRAIGHTEN_SAVING_M) continue;
      const tolerance = Math.min(TOLERANCE_MAX_M, Math.max(TOLERANCE_MIN_M, (errorTotal / (j - i - 1)) * TOLERANCE_FACTOR));
      const line = [origin, ...path, target.m];
      nearSegment = 1;
      let fits = true;
      for (let k = i + 1; k < j && fits; k += 1) if (!nearLine(k, line, tolerance)) fits = false;
      if (fits) {
        bestJ = j;
        bestPath = path;
      }
    }
    if (bestJ < 0) {
      i = next(i);
      continue;
    }
    for (let k = i + 1; k < bestJ; k += 1) skipped[k] = 1;
    inserted[bestJ] = trimSpikes(origin, bestPath, chosen[bestJ]!.m);
    for (let k = i + 1; k <= bestJ; k += 1) badState[k] = 0;
    i = bestJ;
  }

  const out: Draft[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const s = chosen[i];
    if (skipped[i]) out[i] = { index: i, position: pts[i], path: [], skipped: true, matched: false, m: null };
    else if (!s) out[i] = { index: i, position: pts[i], path: [], skipped: false, matched: false, m: null };
    else out[i] = { index: i, position: at(s.m), path: inserted[i], skipped: false, matched: true, m: s.m };
  }

  const routeBetween = (a: Draft, c: Draft, current: readonly LngLat[]): LngLat[] | null => {
    if (!a.m || !c.m) return null;
    const straight = distanceOf(a.position, c.position);
    search.run(a.m, (straight * GAP_FACTOR + GAP_EXTRA_M) * WEIGHT_FACTOR_MAX, true, [c.m]);
    const r = search.routeTo(c.m);
    const node = r.node;
    if (!Number.isFinite(r.length) || search.wrongWay(c.m, node)) return null;
    const path = node >= 0 ? search.path(node) : [];
    return lengthThrough(a.position, path, c.position) < lineLength(current) ? path : null;
  };

  let a: Draft | null = null;
  for (let i = 0; i < n; i += 1) {
    const h = out[i];
    if (h.skipped) continue;
    let ic = i + 1;
    while (ic < n && out[ic].skipped) ic += 1;
    const c = ic < n ? out[ic] : null;
    if (a && c && h.matched && a.matched && c.matched) {
      const before = [a.position, ...h.path];
      const after = [...c.path, c.position];
      let hu = -1;
      let hv = -1;
      for (let u = before.length - 1; u >= 0 && hu < 0; u -= 1) {
        const ahead = [...before.slice(u + 1), h.position];
        for (let v = 0; v < after.length && hu < 0; v += 1) {
          const d = distanceOf(before[u], after[v]);
          if (d < HOOK_M && lineLength([before[u], ...ahead, ...after.slice(0, v + 1)]) > d * 3 + HOOK_M) {
            hu = u;
            hv = v;
          }
        }
      }
      if (hu >= 0) {
        out[i] = { ...h, skipped: true };
        out[ic] = { ...c, path: trimSpikes(a.position, [...before.slice(1, hu + 1), ...after.slice(hv, -1)], c.position) };
        continue;
      }
      const enter = h.path.length ? h.path[h.path.length - 1] : a.position;
      const exit = c.path.length ? c.path[0] : c.position;
      const leg = Math.min(distanceOf(enter, h.position), distanceOf(h.position, exit));
      if (leg < REVERSAL_M && reverses(enter, h.position, exit)) {
        if (leg < JITTER_M) {
          out[i] = { ...h, skipped: true };
          out[ic] = { ...c, path: trimSpikes(a.position, [...h.path, ...c.path], c.position) };
          continue;
        }
        const path = routeBetween(a, c, [a.position, ...h.path, h.position, ...c.path, c.position]);
        if (path) {
          out[i] = { ...h, skipped: true };
          out[ic] = { ...c, path: trimSpikes(a.position, path, c.position) };
          continue;
        }
      }
    }
    a = h;
  }

  return out.map((d) => ({
    index: d.index,
    position: { lng: d.position.lng, lat: d.position.lat },
    path: d.path.map((q) => ({ lng: q.lng, lat: q.lat })),
    skipped: d.skipped,
    matched: d.matched && !d.skipped,
  }));
}

export function toCoordinates(matched: readonly MatchedPoint[]): Position[] {
  const out: [number, number][] = [];
  for (const m of matched) {
    if (m.skipped) continue;
    for (const q of m.path) out.push([q.lng, q.lat]);
    out.push([m.position.lng, m.position.lat]);
  }
  return out;
}

export function matchCoordinates(coordinates: readonly Position[], network: Network, options: MatchOptions = {}): Position[] {
  if (!coordinates.length) return [];
  return toCoordinates(matchPoints(coordinates.map(([lng, lat]) => ({ lng, lat })), network, options));
}

export function snapToRoad(network: Network, position: Position, radius: number = RADIUS_M): Position | null {
  const [lng, lat] = position;
  const [best] = toolsFor(network).finder.find(lng, lat, Math.cos(lat * RAD), null, radius);
  return best ? [best.lng, best.lat] : null;
}

export { distance };
