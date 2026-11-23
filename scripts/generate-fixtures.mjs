import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scenarios } from './scenarios.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reference = process.env.REFERENCE;

async function engine() {
  if (reference) {
    const ref = await import(pathToFileURL(resolve(reference)).href);
    return {
      label: 'reference',
      run(s) {
        const net = ref.bangunJaringan(
          s.roads.map((r) => ({ koordinat: r.coordinates, penalti: r.penalty ?? 0, faktor: r.factor ?? 1, satuArah: r.oneway ?? 0 })),
        );
        const out = ref.tempelUrutan(
          s.points.map(([lng, lat]) => ({ lng, lat })),
          net,
          {
            ...(s.include ? { boleh: (i) => s.include[i] !== false } : {}),
            ...(s.leftHandTraffic ? { kiri: (i) => s.leftHandTraffic[i] === true } : {}),
          },
        );
        return out.map((h) => ({
          index: h.indeks,
          skipped: !!h.lewati,
          position: [h.posisi.lng, h.posisi.lat],
          path: h.sisip.map((q) => [q.lng, q.lat]),
        }));
      },
    };
  }
  const lib = await import(pathToFileURL(resolve(root, 'dist/index.js')).href);
  return {
    label: 'library',
    run(s) {
      const net = lib.buildNetwork(s.roads);
      return lib
        .matchPoints(
          s.points.map(([lng, lat]) => ({ lng, lat })),
          net,
          { include: s.include ?? undefined, leftHandTraffic: s.leftHandTraffic ?? false },
        )
        .map((h) => ({ index: h.index, skipped: h.skipped, position: [h.position.lng, h.position.lat], path: h.path.map((q) => [q.lng, q.lat]) }));
    },
  };
}

const e = await engine();
const dir = resolve(root, 'tests/fixtures');
mkdirSync(dir, { recursive: true });
for (const s of scenarios()) {
  const expected = e.run(s);
  const fixture = {
    name: s.name,
    description: s.description,
    generatedBy: e.label,
    roads: s.roads,
    points: s.points,
    include: s.include ?? null,
    leftHandTraffic: s.leftHandTraffic ?? null,
    expected,
  };
  writeFileSync(resolve(dir, `${s.name}.json`), `${JSON.stringify(fixture)}\n`);
  const kept = expected.filter((h) => !h.skipped).length;
  const inserted = expected.reduce((n, h) => n + h.path.length, 0);
  console.log(`${s.name.padEnd(26)} ${String(s.points.length).padStart(4)} points  ${String(kept).padStart(4)} kept  ${String(inserted).padStart(4)} inserted`);
}
