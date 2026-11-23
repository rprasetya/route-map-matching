import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import { matchPoints, type LngLat, type Network } from 'route-map-matching';
import { createTileSource, type TileSource } from 'route-map-matching/tiles';
import { t } from './i18n';

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

const dots = (list: [number, number][]): GeoJSON.FeatureCollection =>
  collection(list.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } })));

const formatMs = (ms: number) => `${ms < 10 ? ms.toFixed(1) : ms.toFixed(0)} ms`;
const formatLength = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`);

type Mode = 'drive' | 'draw';

const HIT_PX = 14;

function snap(points: [number, number][], network: Network) {
  const t = performance.now();
  const matched = matchPoints(points.map(([lng, lat]): LngLat => ({ lng, lat })), network);
  const ms = performance.now() - t;
  const route: [number, number][] = [];
  const snapped: [number, number][] = [];
  for (const m of matched) {
    if (m.skipped) continue;
    for (const q of m.path) route.push([q.lng, q.lat]);
    route.push([m.position.lng, m.position.lat]);
    snapped.push([m.position.lng, m.position.lat]);
  }
  return { route, snapped, ms };
}

export function startDemo(): void {
  const container = $('demo-map');
  if (!container) return;
  const map: MapLibreMap = new maplibregl.Map({
    container,
    style: STYLE,
    center: START,
    zoom: 14.3,
    attributionControl: { compact: true },
    maxPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  const panel = $('demo-panel');
  const noise = $<HTMLInputElement>('noise');
  const spacing = $<HTMLInputElement>('spacing');
  const button = $<HTMLButtonElement>('new-route');
  const undo = $<HTMLButtonElement>('undo');
  const clear = $<HTMLButtonElement>('clear');
  const modes = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-mode-option]'));
  let source: TileSource | null = null;
  let mode: Mode = 'drive';
  let driveNetwork: Network | null = null;
  let driveTrace: Trace | null = null;
  let truth: [number, number][] = [];
  let busy = false;
  let drawNetwork: Network | null = null;
  let drawn: [number, number][] = [];
  let loadSeq = 0;
  let dragIndex = -1;
  let dragged = false;

  const set = (id: string, data: GeoJSON.FeatureCollection) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
  const stats = (points: string, time: string, third: string) => {
    $('stat-points').textContent = points;
    $('stat-time').textContent = time;
    $('stat-third').textContent = third;
  };

  const renderDrive = (trace: Trace) => {
    driveTrace = trace;
    if (!driveNetwork || mode !== 'drive') return;
    const { route, snapped, ms } = snap(trace.points, driveNetwork);
    const before = median(trace.points.map((p) => distanceToLine(p, trace.truth)));
    const after = median(snapped.map((p) => distanceToLine(p, trace.truth)));
    set('truth', collection([line(trace.truth)]));
    set('fixes', dots(trace.points));
    set('matched', collection([line(route)]));
    stats(String(trace.points.length), formatMs(ms), `${before.toFixed(1)} → ${after.toFixed(1)} m`);
  };

  const renderDraw = () => {
    if (mode !== 'draw') return;
    undo.disabled = clear.disabled = drawn.length === 0;
    set('truth', collection(drawn.length > 1 ? [line(drawn)] : []));
    set('fixes', dots(drawn));
    if (!drawNetwork || !drawn.length) {
      set('matched', collection([]));
      stats(String(drawn.length), '–', '–');
      return;
    }
    const { route, ms } = snap(drawn, drawNetwork);
    set('matched', collection(route.length > 1 ? [line(route)] : []));
    stats(String(drawn.length), formatMs(ms), route.length > 1 ? formatLength(lengthOf(route)) : '–');
  };

  const loadDraw = async () => {
    renderDraw();
    if (!source || !drawn.length) return;
    const seq = ++loadSeq;
    try {
      const loaded = await source.loadNetwork(drawn);
      if (seq !== loadSeq) return;
      drawNetwork = loaded.network;
      renderDraw();
    } catch (error) {
      console.error(error);
      if (seq === loadSeq && mode === 'draw') $('stat-third').textContent = t('demo.unavailable');
    }
  };

  const resample = () => {
    $('noise-out').textContent = `${noise.value} m`;
    $('spacing-out').textContent = `${spacing.value} m`;
    if (truth.length > 1) renderDrive({ truth, points: sample(truth, Number(spacing.value), Number(noise.value)) });
  };

  const newRoute = async () => {
    if (busy || !source) return;
    busy = true;
    button.disabled = true;
    button.textContent = t('demo.loading');
    try {
      const c = map.getCenter();
      const center: [number, number] = [c.lng, c.lat];
      const span = 0.022;
      const corners: [number, number][] = [];
      for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) corners.push([center[0] + x * span, center[1] + y * span]);
      const loaded = await source.loadNetwork(corners);
      driveNetwork = loaded.network;
      if (driveNetwork) truth = drive(driveNetwork, center);
      resample();
      if (truth.length > 1 && mode === 'drive') {
        const lngs = truth.map((p) => p[0]);
        const lats = truth.map((p) => p[1]);
        map.fitBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          { padding: { top: 56, bottom: 48, left: 48, right: 48 }, duration: 600, maxZoom: 16 },
        );
      }
    } catch (error) {
      console.error(error);
      if (mode === 'drive') $('stat-third').textContent = t('demo.unavailable');
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = t('demo.newRoute');
    }
  };

  const setMode = (next: Mode) => {
    if (next === mode) return;
    mode = next;
    panel.dataset.mode = next;
    for (const option of modes) option.setAttribute('aria-pressed', String(option.dataset.modeOption === next));
    $('legend-truth').textContent = t(next === 'drive' ? 'demo.legendDriven' : 'demo.legendOrder');
    $('stat-third-label').textContent = t(next === 'drive' ? 'demo.error' : 'demo.length');
    map.getCanvas().style.cursor = next === 'draw' ? 'crosshair' : '';
    if (map.getLayer('fixes')) {
      map.setPaintProperty('fixes', 'circle-radius', next === 'draw' ? 5.5 : 3.4);
      map.setPaintProperty('fixes', 'circle-stroke-width', next === 'draw' ? 2 : 1.2);
    }
    if (next === 'draw') {
      map.doubleClickZoom.disable();
      loadDraw();
      return;
    }
    map.doubleClickZoom.enable();
    loadSeq += 1;
    if (driveTrace) renderDrive(driveTrace);
    else {
      for (const id of ['truth', 'matched', 'fixes']) set(id, collection([]));
      stats('–', '–', '–');
    }
  };

  const nearest = (point: { x: number; y: number }) => {
    let best = -1;
    let bestDistance = HIT_PX * HIT_PX;
    drawn.forEach((p, i) => {
      const s = map.project(p);
      const d = (s.x - point.x) ** 2 + (s.y - point.y) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    return best;
  };

  let frame = 0;
  const moveFix = (lngLat: { lng: number; lat: number }) => {
    drawn[dragIndex] = [lngLat.lng, lngLat.lat];
    dragged = true;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(renderDraw);
  };
  const endDrag = () => {
    if (dragIndex < 0) return;
    dragIndex = -1;
    map.getCanvas().style.cursor = mode === 'draw' ? 'crosshair' : '';
    if (dragged) loadDraw();
  };

  map.on('mousedown', (e) => {
    if (mode !== 'draw') return;
    const i = nearest(e.point);
    if (i < 0) return;
    e.preventDefault();
    dragIndex = i;
    dragged = false;
    map.getCanvas().style.cursor = 'grabbing';
  });
  map.on('touchstart', (e) => {
    if (mode !== 'draw' || e.points.length !== 1) return;
    const i = nearest(e.point);
    if (i < 0) return;
    e.preventDefault();
    dragIndex = i;
    dragged = false;
  });
  map.on('mousemove', (e) => {
    if (mode !== 'draw') return;
    if (dragIndex >= 0) moveFix(e.lngLat);
    else map.getCanvas().style.cursor = nearest(e.point) >= 0 ? 'grab' : 'crosshair';
  });
  map.on('touchmove', (e) => {
    if (dragIndex >= 0) moveFix(e.lngLat);
  });
  map.on('mouseup', endDrag);
  map.on('touchend', endDrag);
  map.on('touchcancel', endDrag);
  map.on('click', (e) => {
    if (mode !== 'draw') return;
    if (dragged) {
      dragged = false;
      return;
    }
    if (nearest(e.point) >= 0) return;
    drawn.push([e.lngLat.lng, e.lngLat.lat]);
    loadDraw();
  });

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
      $('stat-third').textContent = t('demo.unavailable');
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
  undo.addEventListener('click', () => {
    drawn.pop();
    loadDraw();
  });
  clear.addEventListener('click', () => {
    drawn = [];
    loadSeq += 1;
    renderDraw();
  });
  for (const option of modes) option.addEventListener('click', () => setMode(option.dataset.modeOption as Mode));
}
