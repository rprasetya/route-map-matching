import { METERS_PER_DEGREE, RAD } from './constants';

export interface LngLat {
  lng: number;
  lat: number;
}

export type Position = readonly [number, number];

export function distance(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const cos = Math.cos(((aLat + bLat) / 2) * RAD);
  const dx = (bLng - aLng) * cos * METERS_PER_DEGREE;
  const dy = (bLat - aLat) * METERS_PER_DEGREE;
  return Math.sqrt(dx * dx + dy * dy);
}

export const distanceOf = (a: LngLat, b: LngLat): number => distance(a.lng, a.lat, b.lng, b.lat);

export interface Projection {
  t: number;
  lng: number;
  lat: number;
  d: number;
}

export const projection: Projection = { t: 0, lng: 0, lat: 0, d: 0 };

export function project(pLng: number, pLat: number, cosP: number, aLng: number, aLat: number, bLng: number, bLat: number): Projection {
  const ax = aLng * cosP;
  const dx = bLng * cosP - ax;
  const dy = bLat - aLat;
  const pj = dx * dx + dy * dy;
  const t = pj > 0 ? Math.max(0, Math.min(1, ((pLng * cosP - ax) * dx + (pLat - aLat) * dy) / pj)) : 0;
  const lng = aLng + (bLng - aLng) * t;
  const lat = aLat + (bLat - aLat) * t;
  projection.t = t;
  projection.lng = lng;
  projection.lat = lat;
  projection.d = distance(pLng, pLat, lng, lat);
  return projection;
}

export function reverses(a: LngLat, b: LngLat, c: LngLat): boolean {
  const cos = Math.cos(b.lat * RAD);
  const ux = (b.lng - a.lng) * cos;
  const uy = b.lat - a.lat;
  const vx = (c.lng - b.lng) * cos;
  const vy = c.lat - b.lat;
  const n = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
  return n > 0 && (ux * vx + uy * vy) / n < -0.7;
}

export function lineLength(line: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i += 1) total += distance(line[i - 1].lng, line[i - 1].lat, line[i].lng, line[i].lat);
  return total;
}
