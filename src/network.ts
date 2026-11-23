import { CELL, JOIN_M, MERGE_M, NODE_CELL, RAD, WRONG_WAY_FACTOR } from './constants';
import { distance, project, type Position } from './geo';

export type Oneway = -1 | 0 | 1;

export interface Road {
  coordinates: readonly Position[];
  penalty?: number;
  factor?: number;
  oneway?: Oneway;
}

export type RoadInput = Road | readonly Position[];

export interface Network {
  readonly nodeCount: number;
  readonly nodeLng: Float64Array;
  readonly nodeLat: Float64Array;
  readonly arcStart: Int32Array;
  readonly arcNode: Int32Array;
  readonly arcDistance: Float64Array;
  readonly arcWeight: Float64Array;
  readonly edgeCount: number;
  readonly edgeA: Int32Array;
  readonly edgeB: Int32Array;
  readonly edgeLength: Float64Array;
  readonly edgePenalty: Float64Array;
  readonly edgeFactor: Float64Array;
  readonly edgeForward: Float64Array;
  readonly edgeBackward: Float64Array;
  readonly edgeOneway: Int8Array;
  readonly edgeDirX: Float64Array;
  readonly edgeDirY: Float64Array;
  readonly edgeHasDir: Uint8Array;
  readonly cells: Map<number, Int32Array>;
}

const OFFSET = 16777216;
const SPAN = 33554432;
export const cellKey = (gx: number, gy: number): number => (gx + OFFSET) * SPAN + (gy + OFFSET);
const PAIR = 67108864;
const pairKey = (a: number, b: number): number => (a < b ? a * PAIR + b : b * PAIR + a);

function pushTo<T>(map: Map<number, T[]>, key: number, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function forCells(aLng: number, aLat: number, bLng: number, bLat: number, fn: (key: number) => void): void {
  const x0 = Math.floor(Math.min(aLng, bLng) / CELL);
  const x1 = Math.floor(Math.max(aLng, bLng) / CELL);
  const y0 = Math.floor(Math.min(aLat, bLat) / CELL);
  const y1 = Math.floor(Math.max(aLat, bLat) / CELL);
  for (let gx = x0; gx <= x1; gx += 1) for (let gy = y0; gy <= y1; gy += 1) fn(cellKey(gx, gy));
}

export function buildNetwork(roads: readonly RoadInput[]): Network {
  const lngs: number[] = [];
  const lats: number[] = [];
  const nodeCells = new Map<number, number[]>();
  const nodeAt = (lng: number, lat: number): number => {
    const gx = Math.floor(lng / NODE_CELL);
    const gy = Math.floor(lat / NODE_CELL);
    for (let x = gx - 1; x <= gx + 1; x += 1) {
      for (let y = gy - 1; y <= gy + 1; y += 1) {
        const list = nodeCells.get(cellKey(x, y));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 1) {
          const n = list[i];
          if (distance(lngs[n], lats[n], lng, lat) <= MERGE_M) return n;
        }
      }
    }
    const n = lngs.length;
    lngs.push(lng);
    lats.push(lat);
    pushTo(nodeCells, cellKey(gx, gy), n);
    return n;
  };

  const pieceA: number[] = [];
  const pieceB: number[] = [];
  const piecePenalty: number[] = [];
  const pieceFactor: number[] = [];
  const pieceOneway: number[] = [];
  const pieceSplits: ({ t: number; n: number }[] | null)[] = [];
  const pairs = new Set<number>();
  const degree = new Map<number, number>();
  for (const item of roads) {
    const plain = Array.isArray(item);
    const line = (plain ? item : (item as Road).coordinates) as readonly Position[];
    const penalty = plain ? 0 : ((item as Road).penalty ?? 0);
    const factor = plain ? 1 : ((item as Road).factor ?? 1);
    const oneway = plain ? 0 : ((item as Road).oneway ?? 0);
    for (let i = 1; i < line.length; i += 1) {
      const a = nodeAt(line[i - 1][0], line[i - 1][1]);
      const b = nodeAt(line[i][0], line[i][1]);
      const key = pairKey(a, b);
      if (a === b || pairs.has(key)) continue;
      pairs.add(key);
      pieceA.push(a);
      pieceB.push(b);
      piecePenalty.push(penalty);
      pieceFactor.push(factor);
      pieceOneway.push(oneway);
      pieceSplits.push(null);
      degree.set(a, (degree.get(a) ?? 0) + 1);
      degree.set(b, (degree.get(b) ?? 0) + 1);
    }
  }

  const pieceCells = new Map<number, number[]>();
  for (let p = 0; p < pieceA.length; p += 1) {
    forCells(lngs[pieceA[p]], lats[pieceA[p]], lngs[pieceB[p]], lats[pieceB[p]], (key) => pushTo(pieceCells, key, p));
  }
  for (const [n, d] of degree) {
    if (d !== 1) continue;
    const nLng = lngs[n];
    const nLat = lats[n];
    const cosN = Math.cos(nLat * RAD);
    const gx = Math.floor(nLng / CELL);
    const gy = Math.floor(nLat / CELL);
    let bestPiece = -1;
    let bestT = 0;
    let bestD = Infinity;
    for (let x = gx - 1; x <= gx + 1; x += 1) {
      for (let y = gy - 1; y <= gy + 1; y += 1) {
        const list = pieceCells.get(cellKey(x, y));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 1) {
          const p = list[i];
          const a = pieceA[p];
          const b = pieceB[p];
          if (a === n || b === n) continue;
          const pr = project(nLng, nLat, cosN, lngs[a], lats[a], lngs[b], lats[b]);
          if (pr.d > JOIN_M || pr.t <= 0 || pr.t >= 1) continue;
          if (bestPiece < 0 || pr.d < bestD) {
            bestPiece = p;
            bestT = pr.t;
            bestD = pr.d;
          }
        }
      }
    }
    if (bestPiece >= 0) (pieceSplits[bestPiece] ??= []).push({ t: bestT, n });
  }

  const edgeA: number[] = [];
  const edgeB: number[] = [];
  const edgeLength: number[] = [];
  const edgePenalty: number[] = [];
  const edgeFactor: number[] = [];
  const edgeForward: number[] = [];
  const edgeBackward: number[] = [];
  const edgeOneway: number[] = [];
  const linked = new Set<number>();
  const addEdge = (a: number, b: number, penalty: number, factor: number, oneway: number): void => {
    const key = pairKey(a, b);
    if (a === b || linked.has(key)) return;
    linked.add(key);
    edgeA.push(a);
    edgeB.push(b);
    edgeLength.push(distance(lngs[a], lats[a], lngs[b], lats[b]));
    edgePenalty.push(penalty);
    edgeFactor.push(factor);
    edgeForward.push(oneway < 0 ? WRONG_WAY_FACTOR : 1);
    edgeBackward.push(oneway > 0 ? WRONG_WAY_FACTOR : 1);
    edgeOneway.push(oneway);
  };
  for (let p = 0; p < pieceA.length; p += 1) {
    const splits = pieceSplits[p];
    if (!splits) {
      addEdge(pieceA[p], pieceB[p], piecePenalty[p], pieceFactor[p], pieceOneway[p]);
      continue;
    }
    const order = [pieceA[p], ...splits.sort((x, y) => x.t - y.t).map((s) => s.n), pieceB[p]];
    for (let i = 1; i < order.length; i += 1) addEdge(order[i - 1], order[i], piecePenalty[p], pieceFactor[p], pieceOneway[p]);
  }

  const nodeCount = lngs.length;
  const edgeCount = edgeA.length;
  const arcStart = new Int32Array(nodeCount + 1);
  for (let e = 0; e < edgeCount; e += 1) {
    arcStart[edgeA[e] + 1] += 1;
    arcStart[edgeB[e] + 1] += 1;
  }
  for (let n = 0; n < nodeCount; n += 1) arcStart[n + 1] += arcStart[n];
  const fill = arcStart.slice(0, nodeCount);
  const arcNode = new Int32Array(edgeCount * 2);
  const arcDistance = new Float64Array(edgeCount * 2);
  const arcWeight = new Float64Array(edgeCount * 2);
  const dirX = new Float64Array(edgeCount);
  const dirY = new Float64Array(edgeCount);
  const hasDir = new Uint8Array(edgeCount);
  const edgeCells = new Map<number, number[]>();
  for (let e = 0; e < edgeCount; e += 1) {
    const a = edgeA[e];
    const b = edgeB[e];
    const d = edgeLength[e];
    let i = fill[a]++;
    arcNode[i] = b;
    arcDistance[i] = d * edgeForward[e];
    arcWeight[i] = d * edgeFactor[e] * edgeForward[e];
    i = fill[b]++;
    arcNode[i] = a;
    arcDistance[i] = d * edgeBackward[e];
    arcWeight[i] = d * edgeFactor[e] * edgeBackward[e];
    const cos = Math.cos(((lats[a] + lats[b]) / 2) * RAD);
    const dx = (lngs[b] - lngs[a]) * cos;
    const dy = lats[b] - lats[a];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      dirX[e] = dx / len;
      dirY[e] = dy / len;
      hasDir[e] = 1;
    }
    forCells(lngs[a], lats[a], lngs[b], lats[b], (key) => pushTo(edgeCells, key, e));
  }
  const cells = new Map<number, Int32Array>();
  for (const [key, list] of edgeCells) cells.set(key, Int32Array.from(list));

  return {
    nodeCount,
    nodeLng: Float64Array.from(lngs),
    nodeLat: Float64Array.from(lats),
    arcStart,
    arcNode,
    arcDistance,
    arcWeight,
    edgeCount,
    edgeA: Int32Array.from(edgeA),
    edgeB: Int32Array.from(edgeB),
    edgeLength: Float64Array.from(edgeLength),
    edgePenalty: Float64Array.from(edgePenalty),
    edgeFactor: Float64Array.from(edgeFactor),
    edgeForward: Float64Array.from(edgeForward),
    edgeBackward: Float64Array.from(edgeBackward),
    edgeOneway: Int8Array.from(edgeOneway),
    edgeDirX: dirX,
    edgeDirY: dirY,
    edgeHasDir: hasDir,
    cells,
  };
}
