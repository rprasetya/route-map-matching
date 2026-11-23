const MPD = 111320;

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(random) {
  let u = 0;
  while (u === 0) u = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

export function frame(lng0, lat0) {
  const kx = MPD * Math.cos((lat0 * Math.PI) / 180);
  const round = (v) => Math.round(v * 1e7) / 1e7;
  return {
    at: (x, y) => [round(lng0 + x / kx), round(lat0 + y / MPD)],
    line: (pts) => pts.map(([x, y]) => [round(lng0 + x / kx), round(lat0 + y / MPD)]),
  };
}

export function walk(path, spacing, sigma, random, f, options = {}) {
  const out = [];
  let carry = 0;
  for (let i = 1; i < path.length; i += 1) {
    const [x0, y0] = path[i - 1];
    const [x1, y1] = path[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    let d = carry;
    while (d <= len) {
      const t = len ? d / len : 0;
      const nx = gauss(random) * sigma + (options.biasX ?? 0);
      const ny = gauss(random) * sigma + (options.biasY ?? 0);
      out.push(f.at(x0 + (x1 - x0) * t + nx, y0 + (y1 - y0) * t + ny));
      d += spacing * (options.jitterSpacing ? 0.6 + random() * 0.8 : 1);
    }
    carry = d - len;
  }
  return out;
}

function grid(f, cols, rows, spacing, classify = () => ({})) {
  const roads = [];
  for (let r = 0; r <= rows; r += 1) {
    roads.push({ coordinates: f.line(Array.from({ length: cols + 1 }, (_, c) => [c * spacing, r * spacing])), ...classify('row', r) });
  }
  for (let c = 0; c <= cols; c += 1) {
    roads.push({ coordinates: f.line(Array.from({ length: rows + 1 }, (_, r) => [c * spacing, r * spacing])), ...classify('col', c) });
  }
  return roads;
}

export function scenarios() {
  const list = [];

  {
    const f = frame(106.8, -6.2);
    const random = rng(1);
    list.push({
      name: 'straight-road',
      description: 'A single 2 km road with GPS noise (sigma 6 m).',
      roads: [{ coordinates: f.line([[0, 0], [700, 0], [1400, 0], [2000, 0]]) }],
      points: walk([[0, 0], [2000, 0]], 30, 6, random, f),
    });
  }

  {
    const f = frame(106.82, -6.21);
    const random = rng(2);
    const s = 150;
    const route = [[0, 0], [3 * s, 0], [3 * s, 2 * s], [6 * s, 2 * s], [6 * s, 5 * s], [2 * s, 5 * s], [2 * s, 7 * s]];
    list.push({
      name: 'grid-turns',
      description: 'An 8x8 city grid (150 m blocks) with six turns and 8 m noise.',
      roads: grid(f, 8, 8, s, (kind, i) => (i % 4 === 0 ? { penalty: 0, factor: 1 } : { penalty: 6, factor: 1.6 })),
      points: walk(route, 25, 8, random, f),
    });
  }

  {
    const f = frame(117.14, -0.5);
    const random = rng(3);
    list.push({
      name: 'parallel-roads',
      description: 'A main road with a parallel service road 15 m away; the vehicle stays on the main road.',
      roads: [
        { coordinates: f.line([[0, 0], [800, 0], [1600, 0]]), penalty: 0, factor: 1 },
        { coordinates: f.line([[0, 15], [800, 15], [1600, 15]]), penalty: 12, factor: 2.56 },
        { coordinates: f.line([[400, 0], [400, 15]]), penalty: 12, factor: 2.56 },
        { coordinates: f.line([[1200, 0], [1200, 15]]), penalty: 12, factor: 2.56 },
      ],
      points: walk([[0, 0], [1600, 0]], 28, 7, random, f, { biasY: 4 }),
    });
  }

  {
    const f = frame(117.15, -0.51);
    const random = rng(4);
    const roads = [
      { coordinates: f.line([[0, 7], [600, 7], [1200, 7]]), oneway: 1 },
      { coordinates: f.line([[0, -7], [600, -7], [1200, -7]]), oneway: -1 },
      { coordinates: f.line([[0, -7], [0, 7]]) },
      { coordinates: f.line([[1200, -7], [1200, 7]]) },
    ];
    const points = [...walk([[0, 0], [1200, 0]], 30, 5, random, f), ...walk([[1200, 0], [0, 0]], 30, 5, random, f)];
    list.push({
      name: 'divided-oneway-left-hand',
      description: 'A divided road with one-way carriageways in a left-hand-traffic region; out and back.',
      roads,
      points,
      leftHandTraffic: points.map(() => true),
    });
  }

  {
    const f = frame(106.83, -6.22);
    const random = rng(5);
    const s = 200;
    const route = [[0, 0], [5 * s, 0], [5 * s, 4 * s]];
    const all = walk(route, 25, 6, random, f);
    const points = all.filter((_, i) => i < 15 || i > 38);
    list.push({
      name: 'gps-gap',
      description: 'A 600 m stretch with no GPS fixes around a corner, so the gap has to be routed.',
      roads: grid(f, 6, 5, s),
      points,
    });
  }

  {
    const f = frame(106.84, -6.23);
    const random = rng(6);
    const before = walk([[0, 0], [900, 0]], 30, 6, random, f);
    const stop = Array.from({ length: 12 }, () => f.at(900 + gauss(random) * 10, 20 + gauss(random) * 10));
    const after = walk([[900, 0], [900, 900]], 30, 6, random, f);
    const points = [...before, ...stop, ...after];
    list.push({
      name: 'excluded-stop',
      description: 'A parked cluster beside the road is excluded with the include flags.',
      roads: [{ coordinates: f.line([[0, 0], [900, 0], [1500, 0]]) }, { coordinates: f.line([[900, 0], [900, 900]]) }],
      points,
      include: points.map((_, i) => i < before.length || i >= before.length + stop.length),
    });
  }

  {
    const f = frame(106.85, -6.24);
    const random = rng(7);
    const s = 180;
    const points = walk([[0, 0], [4 * s, 0], [4 * s, 3 * s]], 25, 5, random, f);
    points[10] = f.at(10 * 25, 70);
    points[24] = f.at(4 * s + 60, 0);
    list.push({
      name: 'spikes',
      description: 'Two GPS spikes (70 m and 60 m off the road) that must not create detours.',
      roads: grid(f, 5, 4, s),
      points,
    });
  }

  {
    const f = frame(106.86, -6.25);
    const random = rng(8);
    const road = walk([[0, 0], [700, 0]], 30, 5, random, f);
    const lot = walk([[700, 0], [760, 150], [820, 150], [880, 0]], 15, 4, random, f);
    const back = walk([[880, 0], [1500, 0]], 30, 5, random, f);
    list.push({
      name: 'off-road-detour',
      description: 'The vehicle leaves the network into a lot 150 m away, then comes back.',
      roads: [{ coordinates: f.line([[0, 0], [750, 0], [1500, 0]]) }],
      points: [...road, ...lot, ...back],
    });
  }

  {
    const f = frame(106.87, -6.26);
    const random = rng(9);
    const ring = Array.from({ length: 25 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      return [Math.cos(a) * 40, Math.sin(a) * 40];
    });
    const roads = [
      { coordinates: f.line(ring) },
      { coordinates: f.line([[-500, 0], [-40, 0]]) },
      { coordinates: f.line([[40, 0], [500, 0]]) },
      { coordinates: f.line([[0, -500], [0, -40]]) },
      { coordinates: f.line([[0, 40], [0, 500]]) },
    ];
    const route = [[-500, 0], ...ring.slice(6, 13).reverse(), [0, 500]];
    list.push({ name: 'roundabout', description: 'Enter a roundabout from the west and leave to the north.', roads, points: walk(route, 12, 4, random, f) });
  }

  {
    const f = frame(106.88, -6.27);
    const random = rng(10);
    const roads = [{ coordinates: f.line([[0, 0], [1200, 0]]), penalty: 0, factor: 1 }];
    for (const x of [200, 500, 800]) {
      roads.push({ coordinates: f.line([[x, 1.8], [x, 400]]), penalty: 6, factor: 1.6 });
      roads.push({ coordinates: f.line([[x + 1, -2], [x + 1, -400]]), penalty: 6, factor: 1.6 });
    }
    list.push({
      name: 't-junctions',
      description: 'Side streets end within 2 m of the main road without a shared vertex.',
      roads,
      points: walk([[0, 0], [500, 0], [500, 380]], 20, 5, random, f),
    });
  }

  {
    const f = frame(117.13, -0.49);
    const random = rng(11);
    const s = 120;
    const route = [[0, 0]];
    let x = 0;
    let y = 0;
    for (let k = 0; k < 18; k += 1) {
      if (k % 2 === 0) x = Math.min(14, x + 1 + Math.floor(random() * 3));
      else y = Math.min(14, y + 1 + Math.floor(random() * 2));
      route.push([x * s, y * s]);
    }
    list.push({
      name: 'urban-long',
      description: 'A long staircase route through a 15x15 grid with mixed road classes and one-way streets.',
      roads: grid(f, 15, 15, s, (kind, i) => ({
        penalty: i % 5 === 0 ? 0 : i % 2 ? 6 : 2,
        factor: i % 5 === 0 ? 1 : i % 2 ? 1.6 : 1.2,
        oneway: kind === 'row' && i % 3 === 1 ? 1 : 0,
      })),
      points: walk(route, 22, 7, random, f, { jitterSpacing: true }),
      leftHandTraffic: null,
    });
  }

  return list;
}

export function benchmarkScenario(points = 5000, size = 40, seed = 99) {
  const f = frame(117.1, -0.45);
  const random = rng(seed);
  const s = 110;
  const route = [[0, 0]];
  let x = 0;
  let y = 0;
  let length = 0;
  while (length < points * 22) {
    const nx = Math.max(0, Math.min(size, x + (random() < 0.5 ? 1 : -1) * (1 + Math.floor(random() * 4))));
    const ny = Math.max(0, Math.min(size, y + (random() < 0.5 ? 1 : -1) * (1 + Math.floor(random() * 3))));
    if (random() < 0.5) {
      length += Math.abs(nx - x) * s;
      x = nx;
    } else {
      length += Math.abs(ny - y) * s;
      y = ny;
    }
    route.push([x * s, y * s]);
  }
  return {
    name: `benchmark-${points}`,
    roads: grid(f, size, size, s, (kind, i) => ({ penalty: i % 5 === 0 ? 0 : 6, factor: i % 5 === 0 ? 1 : 1.6, oneway: kind === 'col' && i % 4 === 2 ? -1 : 0 })),
    points: walk(route, 22, 7, random, f, { jitterSpacing: true }).slice(0, points),
  };
}
