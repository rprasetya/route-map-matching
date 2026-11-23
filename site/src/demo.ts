import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import { matchPoints, type LngLat, type Network } from 'route-map-matching';
import { createTileSource, type TileSource } from 'route-map-matching/tiles';

const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const START: [number, number] = [106.8272, -6.1795];
const MPD = 111320;
const ROUTE_M = 2600;

interface Trace {
  truth: [number, number][];
  points: [number, number][];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function gaussian(): number {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

function meters(a: [number, number], b: [number, number]): number {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * k * MPD, (b[1] - a[1]) * MPD);
}

function distanceToLine(p: [number, number], line: [number, number][]): number {
  const k = Math.cos((p[1] * Math.PI) / 180);
  let best = Infinity;
  for (let i = 1; i < line.length; i += 1) {
    const ax = line[i - 1][0] * k * MPD;
    const ay = line[i - 1][1] * MPD;
    const bx = line[i][0] * k * MPD;
    const by = line[i][1] * MPD;
    const px = p[0] * k * MPD;
    const py = p[1] * MPD;
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(px - ax - dx * t, py - ay - dy * t));
  }
  return best;
}

const MAJOR = 1.25;
const ROAD = 1.7;

function majorArcs(net: Network, node: number): number {
  let count = 0;
  for (let i = net.arcStart[node]; i < net.arcStart[node + 1]; i += 1) if (net.arcWeight[i] / net.arcDistance[i] <= MAJOR) count += 1;
  return count;
}

function walk(net: Network, start: number): [number, number][] {
  const visited = new Set<number>([start]);
  const path: [number, number][] = [[net.nodeLng[start], net.nodeLat[start]]];
  let node = start;
  let prev = -1;
  let length = 0;
  while (length < ROUTE_M) {
    let best = -1;
    let bestScore = Infinity;
    for (let i = net.arcStart[node]; i < net.arcStart[node + 1]; i += 1) {
      const next = net.arcNode[i];
      const factor = net.arcWeight[i] / net.arcDistance[i];
      if (next === prev || visited.has(next) || factor > ROAD) continue;
      if (net.arcDistance[i] > meters([net.nodeLng[node], net.nodeLat[node]], [net.nodeLng[next], net.nodeLat[next]]) * 1.5) continue;
      let turn = 0;
      if (prev >= 0) {
        const ax = net.nodeLng[node] - net.nodeLng[prev];
        const ay = net.nodeLat[node] - net.nodeLat[prev];
        const bx = net.nodeLng[next] - net.nodeLng[node];
        const by = net.nodeLat[next] - net.nodeLat[node];
        turn = 1 - (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
      }
      const score = (factor - 1) * 3 + turn * 1.2 + Math.random() * 0.8;
      if (score < bestScore) {
        bestScore = score;
        best = next;
      }
    }
    if (best < 0) break;
    const point: [number, number] = [net.nodeLng[best], net.nodeLat[best]];
    length += meters(path[path.length - 1], point);
    path.push(point);
    visited.add(best);
    prev = node;
    node = best;
  }
  return path;
}

function lengthOf(path: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += meters(path[i - 1], path[i]);
  return total;
}

function drive(net: Network, center: [number, number]): [number, number][] {
  const starts: [number, number][] = [];
  for (let n = 0; n < net.nodeCount; n += 1) {
    if (majorArcs(net, n) >= 2) starts.push([meters(center, [net.nodeLng[n], net.nodeLat[n]]), n]);
  }
  starts.sort((a, b) => a[0] - b[0]);
  const pool = starts.slice(0, 40).map((s) => s[1]);
  if (!pool.length) return [];
  let best: [number, number][] = [];
  let bestLength = 0;
  for (let attempt = 0; attempt < 60 && bestLength < ROUTE_M; attempt += 1) {
    const path = walk(net, pool[Math.floor(Math.random() * pool.length)]);
    const length = lengthOf(path);
    if (length > bestLength) {
      best = path;
      bestLength = length;
    }
  }
  return best;
}

function sample(truth: [number, number][], spacing: number, noise: number): [number, number][] {
  const out: [number, number][] = [];
  let carry = 0;
  for (let i = 1; i < truth.length; i += 1) {
    const a = truth[i - 1];
    const b = truth[i];
    const len = meters(a, b);
    let d = carry;
    while (d <= len) {
      const t = len ? d / len : 0;
      const k = Math.cos((a[1] * Math.PI) / 180);
      out.push([a[0] + (b[0] - a[0]) * t + (gaussian() * noise) / (MPD * k), a[1] + (b[1] - a[1]) * t + (gaussian() * noise) / MPD]);
      d += spacing * (0.75 + Math.random() * 0.5);
    }
    carry = d - len;
  }
  return out;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const collection = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const line = (coordinates: [number, number][]): GeoJSON.Feature => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } });

export function startDemo(): void {
  const container = $('demo-map');
  if (!container) return;
  const map: MapLibreMap = new maplibregl.Map({
    container,
    style: STYLE,
    center: START,
    zoom: 14.3,
    attributionControl: { compact: true },
    cooperativeGestures: true,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  const noise = $<HTMLInputElement>('noise');
  const spacing = $<HTMLInputElement>('spacing');
  const button = $<HTMLButtonElement>('new-route');
  let source: TileSource | null = null;
  let network: Network | null = null;
  let truth: [number, number][] = [];
  let busy = false;

  const set = (id: string, data: GeoJSON.FeatureCollection) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);

  const render = (trace: Trace) => {
    if (!network) return;
    const t = performance.now();
    const matched = matchPoints(trace.points.map(([lng, lat]): LngLat => ({ lng, lat })), network);
    const ms = performance.now() - t;
    const route: [number, number][] = [];
    const after: number[] = [];
    for (const m of matched) {
      if (m.skipped) continue;
      for (const q of m.path) route.push([q.lng, q.lat]);
      route.push([m.position.lng, m.position.lat]);
      after.push(distanceToLine([m.position.lng, m.position.lat], trace.truth));
    }
    const before = median(trace.points.map((p) => distanceToLine(p, trace.truth)));
    set('truth', collection([line(trace.truth)]));
    set('fixes', collection(trace.points.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }))));
    set('matched', collection([line(route)]));
    $('stat-points').textContent = String(trace.points.length);
    $('stat-time').textContent = `${ms < 10 ? ms.toFixed(1) : ms.toFixed(0)} ms`;
    $('stat-error').textContent = `${before.toFixed(1)} → ${median(after).toFixed(1)} m`;
  };

  const resample = () => {
    $('noise-out').textContent = `${noise.value} m`;
    $('spacing-out').textContent = `${spacing.value} m`;
    if (truth.length > 1) render({ truth, points: sample(truth, Number(spacing.value), Number(noise.value)) });
  };

  const newRoute = async () => {
    if (busy || !source) return;
    busy = true;
    button.disabled = true;
    button.textContent = 'Loading roads…';
    try {
      const c = map.getCenter();
      const center: [number, number] = [c.lng, c.lat];
      const span = 0.022;
      const corners: [number, number][] = [];
      for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) corners.push([center[0] + x * span, center[1] + y * span]);
      const loaded = await source.loadNetwork(corners);
      network = loaded.network;
      if (network) truth = drive(network, center);
      resample();
      if (truth.length > 1) {
        const lngs = truth.map((p) => p[0]);
        const lats = truth.map((p) => p[1]);
        map.fitBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          { padding: { top: 48, bottom: 48, left: 48, right: 48 }, duration: 600, maxZoom: 16 },
        );
      }
    } catch (error) {
      console.error(error);
      $('stat-error').textContent = 'Road tiles unavailable';
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = 'Drive a new route';
    }
  };

  map.on('load', () => {
    for (const id of ['truth', 'matched', 'fixes']) map.addSource(id, { type: 'geojson', data: collection([]) });
    map.addLayer({ id: 'truth', type: 'line', source: 'truth', paint: { 'line-color': '#6b6f76', 'line-width': 2, 'line-dasharray': [1.5, 1.5], 'line-opacity': 0.7 } });
    map.addLayer({ id: 'matched-casing', type: 'line', source: 'matched', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 8 } });
    map.addLayer({ id: 'matched', type: 'line', source: 'matched', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#d4900f', 'line-width': 4.5 } });
    map.addLayer({ id: 'fixes', type: 'circle', source: 'fixes', paint: { 'circle-radius': 3.4, 'circle-color': '#d4483b', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2, 'circle-opacity': 0.9 } });
    const sources = map.getStyle().sources;
    const id = Object.keys(sources).find((k) => sources[k].type === 'vector');
    const tiles = id ? (map.getSource(id) as unknown as { tiles?: string[] }).tiles : undefined;
    if (!tiles?.length) {
      $('stat-error').textContent = 'Road tiles unavailable';
      return;
    }
    source = createTileSource({ url: tiles[0], zoom: 14 });
    newRoute();
  });

  let pending = 0;
  const later = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(resample);
  };
  noise.addEventListener('input', later);
  spacing.addEventListener('input', later);
  button.addEventListener('click', newRoute);
}
