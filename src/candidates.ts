import { CELL, HEADING_PENALTY_M, LEFT_BIAS, MAX_CANDIDATES, METERS_PER_DEGREE, NEAR_M, PARALLEL_MIN, WRONG_WAY_PENALTY_M } from './constants';
import { project } from './geo';
import { cellKey, type Network } from './network';

export interface Candidate {
  edge: number;
  t: number;
  lng: number;
  lat: number;
  score: number;
}

export interface Heading {
  x: number;
  y: number;
}

export class CandidateFinder {
  private readonly seen: Uint32Array;
  private epoch = 0;

  constructor(private readonly net: Network) {
    this.seen = new Uint32Array(net.edgeCount);
  }

  find(lng: number, lat: number, cos: number, heading: Heading | null, radius: number, leftHand = false, confident = false): Candidate[] {
    const net = this.net;
    if (++this.epoch === 0xffffffff) {
      this.seen.fill(0);
      this.epoch = 1;
    }
    const epoch = this.epoch;
    const reach = Math.ceil(radius / (CELL * METERS_PER_DEGREE));
    const gx = Math.floor(lng / CELL);
    const gy = Math.floor(lat / CELL);
    const list: Candidate[] = [];
    for (let x = gx - reach; x <= gx + reach; x += 1) {
      for (let y = gy - reach; y <= gy + reach; y += 1) {
        const edges = net.cells.get(cellKey(x, y));
        if (!edges) continue;
        for (let i = 0; i < edges.length; i += 1) {
          const e = edges[i];
          if (this.seen[e] === epoch) continue;
          this.seen[e] = epoch;
          const a = net.edgeA[e];
          const b = net.edgeB[e];
          const pr = project(lng, lat, cos, net.nodeLng[a], net.nodeLat[a], net.nodeLng[b], net.nodeLat[b]);
          if (pr.d > radius) continue;
          const aligned = heading !== null && net.edgeHasDir[e] === 1;
          const along = aligned ? heading.x * net.edgeDirX[e] + heading.y * net.edgeDirY[e] : 0;
          const parallel = aligned ? Math.abs(along) : 1;
          if (parallel < PARALLEL_MIN && pr.d > NEAR_M) continue;
          let score = pr.d + HEADING_PENALTY_M * (1 - parallel) + net.edgePenalty[e];
          if (confident && heading !== null && parallel >= PARALLEL_MIN) {
            if (net.edgeOneway[e] * along < 0) score += WRONG_WAY_PENALTY_M;
            if (leftHand) score -= LEFT_BIAS * (heading.x * (pr.lat - lat) * METERS_PER_DEGREE - heading.y * (pr.lng - lng) * cos * METERS_PER_DEGREE);
          }
          list.push({ edge: e, t: pr.t, lng: pr.lng, lat: pr.lat, score });
        }
      }
    }
    if (list.length > 1) list.sort((p, q) => p.score - q.score);
    if (list.length > MAX_CANDIDATES) list.length = MAX_CANDIDATES;
    return list;
  }
}
