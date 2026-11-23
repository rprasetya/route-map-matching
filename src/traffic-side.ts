import DATA from '../data/left-hand-traffic.txt';

interface Region {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  rings: Float64Array[];
}

let regions: Region[] | null = null;

function decode(): Region[] {
  return DATA.split(',').map((polygon) => {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    const rings = polygon.split(' ').map((s) => {
      const out: number[] = [];
      let i = 0;
      let x = 0;
      let y = 0;
      const next = (): number => {
        let shift = 0;
        let value = 0;
        let b: number;
        do {
          b = s.charCodeAt(i++) - 63;
          value |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        return value & 1 ? ~(value >> 1) : value >> 1;
      };
      while (i < s.length) {
        x += next();
        y += next();
        const lng = x / 1000;
        const lat = y / 1000;
        out.push(lng, lat);
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
      return Float64Array.from(out);
    });
    return { minLng, minLat, maxLng, maxLat, rings };
  });
}

export function isLeftHandTraffic(lng: number, lat: number): boolean {
  regions ??= decode();
  for (const r of regions) {
    if (lng < r.minLng || lng > r.maxLng || lat < r.minLat || lat > r.maxLat) continue;
    let inside = false;
    for (const t of r.rings) {
      for (let i = 0, j = t.length - 2; i < t.length; j = i, i += 2) {
        if (t[i + 1] > lat !== t[j + 1] > lat && lng < ((t[j] - t[i]) * (lat - t[i + 1])) / (t[j + 1] - t[i + 1]) + t[i]) inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

export function leftHandTrafficFlags(coordinates: readonly (readonly [number, number])[]): boolean[] {
  return coordinates.map(([lng, lat]) => isLeftHandTraffic(lng, lat));
}

export function leftHandTrafficPolygons(): number[][][][] {
  regions ??= decode();
  return regions.map((r) =>
    r.rings.map((ring) => {
      const out: number[][] = [];
      for (let i = 0; i < ring.length; i += 2) out.push([ring[i], ring[i + 1]]);
      return out;
    }),
  );
}
