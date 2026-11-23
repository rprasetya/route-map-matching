import { describe, expect, it } from 'vitest';
import { createTileSource, decodeTile, tileX, tileY } from '../src/tiles';
import { isLeftHandTraffic, leftHandTrafficFlags } from '../src/traffic-side';

const varint = (n: number): number[] => {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
};
const zz = (n: number): number => (n >= 0 ? n * 2 : -n * 2 - 1);
const field = (num: number, type: number): number[] => varint(num * 8 + type);
const bytes = (num: number, data: number[]): number[] => [...field(num, 2), ...varint(data.length), ...data];
const text = (s: string): number[] => [...new TextEncoder().encode(s)];
const packed = (num: number, values: number[]): number[] => bytes(num, values.flatMap(varint));

function lineGeometry(points: [number, number][]): number[] {
  const cmds: number[] = [];
  let x = 0;
  let y = 0;
  points.forEach(([px, py], i) => {
    if (i === 0) cmds.push((1 & 7) | (1 << 3));
    if (i === 1) cmds.push((2 & 7) | ((points.length - 1) << 3));
    cmds.push(zz(px - x), zz(py - y));
    x = px;
    y = py;
  });
  return cmds;
}

function tile(layers: { name: string; keys: string[]; values: (string | number)[]; features: { tags: number[]; line: [number, number][] }[] }[]): Uint8Array {
  const out: number[] = [];
  for (const layer of layers) {
    const body: number[] = [...bytes(1, text(layer.name)), ...field(5, 0), ...varint(4096)];
    for (const f of layer.features) body.push(...bytes(2, [...packed(2, f.tags), ...field(3, 0), ...varint(2), ...packed(4, lineGeometry(f.line))]));
    for (const k of layer.keys) body.push(...bytes(3, text(k)));
    for (const v of layer.values) body.push(...bytes(4, typeof v === 'string' ? bytes(1, text(v)) : [...field(5, 0), ...varint(v)]));
    body.push(...field(15, 0), ...varint(2));
    out.push(...bytes(3, body));
  }
  return Uint8Array.from(out);
}

describe('vector tiles', () => {
  const z = 14;
  const x = tileX(106.8, z);
  const y = tileY(-6.2, z);
  const sample = tile([
    {
      name: 'transportation',
      keys: ['class', 'oneway'],
      values: ['primary', 1, 'path'],
      features: [
        { tags: [0, 0, 1, 1], line: [[0, 2048], [4096, 2048]] },
        { tags: [0, 2], line: [[0, 100], [4096, 100]] },
      ],
    },
    {
      name: 'roads',
      keys: ['kind', 'kind_detail'],
      values: ['minor_road', 'service'],
      features: [{ tags: [0, 0, 1, 1], line: [[2048, -500], [2048, 4600]] }],
    },
    { name: 'water', keys: [], values: [], features: [{ tags: [], line: [[0, 0], [10, 10]] }] },
  ]);

  it('decodes OpenMapTiles and Protomaps road layers with weights', () => {
    const roads = decodeTile(sample, x, y, z);
    expect(roads).toHaveLength(2);
    const [primary, minor] = roads;
    expect(primary).toMatchObject({ penalty: 0, factor: 1, oneway: 1 });
    expect(primary.coordinates).toHaveLength(2);
    expect(primary.coordinates[0][1]).toBeCloseTo(primary.coordinates[1][1], 9);
    expect(minor).toMatchObject({ penalty: 12, factor: 1.6 * 1.6, oneway: 0 });
  });

  it('clips lines to the tile extent', () => {
    const minor = decodeTile(sample, x, y, z)[1];
    const n = 2 ** z;
    const north = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    const south = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
    expect(minor.coordinates[0][1]).toBeCloseTo(north, 9);
    expect(minor.coordinates[1][1]).toBeCloseTo(south, 9);
  });

  it('loads tiles through a tile source and matches a trace', async () => {
    const requested: string[] = [];
    const source = createTileSource({
      url: 'https://tiles.example/{z}/{x}/{y}.pbf',
      maxTiles: 4,
      fetch: async (url) => {
        requested.push(url);
        const ok = url.endsWith(`/${z}/${x}/${y}.pbf`);
        return { ok, status: ok ? 200 : 404, arrayBuffer: async () => sample.slice().buffer };
      },
    });
    const road = decodeTile(sample, x, y, z)[0].coordinates;
    const [w, e] = road;
    const trace: [number, number][] = Array.from({ length: 30 }, (_, i) => {
      const t = 0.2 + (i / 29) * 0.6;
      return [w[0] + (e[0] - w[0]) * t, w[1] + (e[1] - w[1]) * t + (i % 2 ? 0.00004 : -0.00004)];
    });
    const result = await source.match(trace);
    expect(requested.some((u) => u.endsWith(`/${z}/${x}/${y}.pbf`))).toBe(true);
    expect(result.matched).toHaveLength(trace.length);
    for (const [, lat] of result.coordinates) expect(lat).toBeCloseTo(w[1], 6);
    const again = await source.match(trace);
    expect(again.coordinates).toEqual(result.coordinates);
  });
});

describe('traffic side', () => {
  it('knows which side of the road traffic drives on', () => {
    expect(isLeftHandTraffic(106.8456, -6.2088)).toBe(true);
    expect(isLeftHandTraffic(-0.1276, 51.5072)).toBe(true);
    expect(isLeftHandTraffic(139.6917, 35.6895)).toBe(true);
    expect(isLeftHandTraffic(114.17, 22.32)).toBe(true);
    expect(isLeftHandTraffic(119.41, -5.13)).toBe(true);
    expect(isLeftHandTraffic(103.82, 1.35)).toBe(true);
    expect(isLeftHandTraffic(114.05, 22.62)).toBe(false);
    expect(isLeftHandTraffic(120.98, 14.6)).toBe(false);
    expect(isLeftHandTraffic(2.3522, 48.8566)).toBe(false);
    expect(isLeftHandTraffic(-74.006, 40.7128)).toBe(false);
    expect(leftHandTrafficFlags([[106.8456, -6.2088], [2.3522, 48.8566]])).toEqual([true, false]);
  });
});
