import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildNetwork, matchCoordinates, matchPoints, toCoordinates, type Road } from '../src';

interface Fixture {
  name: string;
  roads: Road[];
  points: [number, number][];
  include: boolean[] | null;
  leftHandTraffic: boolean[] | null;
  expected: { index: number; skipped: boolean; position: [number, number]; path: [number, number][] }[];
}

const TOLERANCE = 1e-9;
const dir = resolve(__dirname, 'fixtures');
const fixtures: Fixture[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')));

const close = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

describe('shared fixtures', () => {
  for (const fx of fixtures) {
    it(fx.name, () => {
      const network = buildNetwork(fx.roads);
      const result = matchPoints(
        fx.points.map(([lng, lat]) => ({ lng, lat })),
        network,
        { include: fx.include ?? undefined, leftHandTraffic: fx.leftHandTraffic ?? false },
      );
      expect(result).toHaveLength(fx.expected.length);
      const problems: string[] = [];
      fx.expected.forEach((want, i) => {
        const got = result[i];
        if (got.index !== want.index) problems.push(`#${i} index ${got.index} != ${want.index}`);
        if (got.skipped !== want.skipped) {
          problems.push(`#${i} skipped ${got.skipped} != ${want.skipped}`);
          return;
        }
        if (want.skipped) return;
        if (!close(got.position.lng, want.position[0]) || !close(got.position.lat, want.position[1])) {
          problems.push(`#${i} position ${got.position.lng},${got.position.lat} != ${want.position}`);
        }
        if (got.path.length !== want.path.length) {
          problems.push(`#${i} path length ${got.path.length} != ${want.path.length}`);
          return;
        }
        want.path.forEach(([lng, lat], k) => {
          if (!close(got.path[k].lng, lng) || !close(got.path[k].lat, lat)) problems.push(`#${i} path[${k}] differs`);
        });
      });
      expect(problems).toEqual([]);
    });
  }

  it('matchCoordinates equals toCoordinates(matchPoints)', () => {
    const fx = fixtures.find((f) => f.name === 'grid-turns')!;
    const network = buildNetwork(fx.roads);
    const viaPoints = toCoordinates(matchPoints(fx.points.map(([lng, lat]) => ({ lng, lat })), network));
    expect(matchCoordinates(fx.points, network)).toEqual(viaPoints);
  });

  it('detects left-hand traffic automatically by default', () => {
    const fx = fixtures.find((f) => f.name === 'divided-oneway-left-hand')!;
    const network = buildNetwork(fx.roads);
    const points = fx.points.map(([lng, lat]) => ({ lng, lat }));
    expect(matchPoints(points, network)).toEqual(matchPoints(points, network, { leftHandTraffic: true }));
  });

  it('is deterministic across repeated runs on the same network', () => {
    const fx = fixtures.find((f) => f.name === 'urban-long')!;
    const network = buildNetwork(fx.roads);
    const first = matchCoordinates(fx.points, network);
    for (let k = 0; k < 3; k += 1) expect(matchCoordinates(fx.points, network)).toEqual(first);
  });
});
