import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { benchmarkScenario } from './scenarios.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lib = await import(pathToFileURL(resolve(root, 'dist/index.js')).href);
const ref = process.env.REFERENCE ? await import(pathToFileURL(resolve(process.env.REFERENCE)).href) : null;
const sizes = (process.env.SIZES ?? '1000,5000,20000').split(',').map(Number);
const runs = Number(process.env.RUNS ?? 5);

function time(fn) {
  const t = performance.now();
  const out = fn();
  return [performance.now() - t, out];
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const fmt = (ms) => `${ms.toFixed(ms < 10 ? 2 : 1).padStart(8)} ms`;

console.log(`node ${process.version}, ${runs} runs per case (median)\n`);
for (const size of sizes) {
  const s = benchmarkScenario(size);
  const points = s.points.map(([lng, lat]) => ({ lng, lat }));
  const builds = [];
  const matches = [];
  let network;
  let out;
  for (let r = 0; r < runs; r += 1) {
    const [b, net] = time(() => lib.buildNetwork(s.roads));
    const [m, res] = time(() => lib.matchPoints(points, net, { leftHandTraffic: false }));
    builds.push(b);
    matches.push(m);
    network = net;
    out = res;
  }
  const line = [`${String(size).padStart(6)} points`, `${network.edgeCount} edges`, `build ${fmt(median(builds))}`, `match ${fmt(median(matches))}`, `${((size / median(matches)) * 1000).toFixed(0)} points/s`];
  if (ref) {
    const refBuilds = [];
    const refMatches = [];
    let refOut;
    for (let r = 0; r < runs; r += 1) {
      const [b, net] = time(() => ref.bangunJaringan(s.roads.map((x) => ({ koordinat: x.coordinates, penalti: x.penalty ?? 0, faktor: x.factor ?? 1, satuArah: x.oneway ?? 0 }))));
      const [m, res] = time(() => ref.tempelUrutan(points, net));
      refBuilds.push(b);
      refMatches.push(m);
      refOut = res;
    }
    const same = refOut.every((h, i) => !!h.lewati === out[i].skipped && (h.lewati || (Math.abs(h.posisi.lng - out[i].position.lng) < 1e-9 && Math.abs(h.posisi.lat - out[i].position.lat) < 1e-9 && h.sisip.length === out[i].path.length)));
    line.push(`| reference build ${fmt(median(refBuilds))} match ${fmt(median(refMatches))}`, `speedup x${(median(refMatches) / median(matches)).toFixed(1)}`, same ? 'identical' : 'DIFFERENT');
  }
  console.log(line.join('  '));
}
