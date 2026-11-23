import { ROAD_KINDS } from '../constants';
import type { Oneway, Road } from '../network';

type Value = string | number | boolean | null;
type Getter = (key: string) => Value;
export type RoadClassifier = (get: Getter) => Omit<Road, 'coordinates'> | null;

const KIND_PENALTY: Record<string, number> = { highway: 0, major_road: 0, medium_road: 2, minor_road: 6 };
const DETAIL_PENALTY: Record<string, number> = { service: 6, track: 10, driveway: 10, parking_aisle: 10, alley: 6 };
const KIND_FACTOR: Record<string, number> = { highway: 1, major_road: 1, medium_road: 1.2, minor_road: 1.6 };
const DETAIL_FACTOR: Record<string, number> = { service: 1.6, track: 2, driveway: 2, parking_aisle: 2, alley: 1.5 };
const OPENMAPTILES_CLASS: Record<string, [number, number]> = {
  motorway: [0, 1],
  trunk: [0, 1],
  primary: [0, 1],
  secondary: [0, 1],
  tertiary: [2, 1.2],
  minor: [6, 1.6],
  service: [12, 2.56],
  track: [16, 3.2],
};

export const onewayOf = (v: Value): Oneway => (v === 'yes' || v === 'true' || v === '1' || v === 1 || v === true ? 1 : v === '-1' || v === -1 ? -1 : 0);

export const DEFAULT_LAYERS: Record<string, RoadClassifier> = {
  roads: (get) => {
    const kind = get('kind');
    if (typeof kind !== 'string' || !(ROAD_KINDS as readonly string[]).includes(kind)) return null;
    const detail = get('kind_detail');
    const d = typeof detail === 'string' ? detail : '';
    return {
      penalty: (KIND_PENALTY[kind] ?? 0) + (DETAIL_PENALTY[d] ?? 0),
      factor: (KIND_FACTOR[kind] ?? 1) * (DETAIL_FACTOR[d] ?? 1),
      oneway: onewayOf(get('oneway')),
    };
  },
  transportation: (get) => {
    const cls = get('class');
    const weights = typeof cls === 'string' ? OPENMAPTILES_CLASS[cls] : undefined;
    return weights ? { penalty: weights[0], factor: weights[1], oneway: onewayOf(get('oneway')) } : null;
  },
};

const utf8 = new TextDecoder();

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}

  varint(): number {
    const buf = this.buf;
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = buf[this.pos++];
      result += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b >= 0x80);
    return result;
  }

  int64(): number {
    const buf = this.buf;
    let result = 0n;
    let shift = 0n;
    let b: number;
    do {
      b = buf[this.pos++];
      result |= BigInt(b & 0x7f) << shift;
      shift += 7n;
    } while (b >= 0x80);
    return Number(BigInt.asIntN(64, result));
  }

  skip(type: number): void {
    if (type === 0) this.varint();
    else if (type === 1) this.pos += 8;
    else if (type === 2) this.pos += this.varint();
    else if (type === 5) this.pos += 4;
  }
}

const zigzag = (n: number): number => (n % 2 ? -(n + 1) / 2 : n / 2);

function readValue(buf: Uint8Array, start: number, end: number): Value {
  const r = new Reader(buf);
  r.pos = start;
  let value: Value = null;
  while (r.pos < end) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const type = tag & 7;
    if (field === 1 && type === 2) {
      const len = r.varint();
      value = utf8.decode(buf.subarray(r.pos, r.pos + len));
      r.pos += len;
    } else if (field === 2 && type === 5) {
      value = new DataView(buf.buffer, buf.byteOffset + r.pos, 4).getFloat32(0, true);
      r.pos += 4;
    } else if (field === 3 && type === 1) {
      value = new DataView(buf.buffer, buf.byteOffset + r.pos, 8).getFloat64(0, true);
      r.pos += 8;
    } else if (field === 4 && type === 0) value = r.int64();
    else if ((field === 5 || field === 6 || field === 7) && type === 0) {
      const v = r.varint();
      value = field === 6 ? zigzag(v) : field === 7 ? v === 1 : v;
    } else r.skip(type);
  }
  return value;
}

function clipSegment(ax: number, ay: number, bx: number, by: number, ext: number): [number, number, number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const edges: [number, number][] = [
    [-dx, ax],
    [dx, ext - ax],
    [-dy, ay],
    [dy, ext - ay],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
}

function clipLine(line: number[], ext: number): number[][] {
  const out: number[][] = [];
  let current: number[] | null = null;
  for (let i = 2; i < line.length; i += 2) {
    const c = clipSegment(line[i - 2], line[i - 1], line[i], line[i + 1], ext);
    if (!c) {
      current = null;
      continue;
    }
    if (!current || current[current.length - 2] !== c[0] || current[current.length - 1] !== c[1]) {
      current = [c[0], c[1]];
      out.push(current);
    }
    current.push(c[2], c[3]);
  }
  return out;
}

function toLngLat(px: number, py: number, x: number, y: number, z: number, extent: number): [number, number] {
  const n = 2 ** z;
  const lng = ((x + px / extent) / n) * 360 - 180;
  const yy = Math.PI * (1 - (2 * (y + py / extent)) / n);
  return [lng, (Math.atan(Math.sinh(yy)) * 180) / Math.PI];
}

export interface DecodeOptions {
  layers?: Record<string, RoadClassifier>;
}

export function decodeTile(data: Uint8Array | ArrayBuffer, x: number, y: number, z: number, options: DecodeOptions = {}): Road[] {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const layers = options.layers ?? DEFAULT_LAYERS;
  const roads: Road[] = [];
  const r = new Reader(buf);
  while (r.pos < buf.length) {
    const tag = r.varint();
    const type = tag & 7;
    if (Math.floor(tag / 8) !== 3 || type !== 2) {
      r.skip(type);
      continue;
    }
    const len = r.varint();
    const layerEnd = r.pos + len;
    let name = '';
    let extent = 4096;
    const keys: string[] = [];
    const values: [number, number][] = [];
    const features: [number, number][] = [];
    while (r.pos < layerEnd) {
      const t = r.varint();
      const f = Math.floor(t / 8);
      const ty = t & 7;
      if (ty === 2) {
        const l = r.varint();
        const s = r.pos;
        r.pos += l;
        if (f === 1) name = utf8.decode(buf.subarray(s, s + l));
        else if (f === 2) features.push([s, s + l]);
        else if (f === 3) keys.push(utf8.decode(buf.subarray(s, s + l)));
        else if (f === 4) values.push([s, s + l]);
      } else if (f === 5 && ty === 0) extent = r.varint();
      else r.skip(ty);
    }
    r.pos = layerEnd;
    const classify = layers[name];
    if (!classify) continue;
    const keyIndex = new Map(keys.map((k, i) => [k, i]));
    const valueCache = new Map<number, Value>();
    const valueAt = (i: number): Value => {
      if (!valueCache.has(i)) valueCache.set(i, values[i] ? readValue(buf, values[i][0], values[i][1]) : null);
      return valueCache.get(i)!;
    };
    const fr = new Reader(buf);
    for (const [fs, fe] of features) {
      fr.pos = fs;
      let tags: number[] = [];
      let geomType = 0;
      let geom: number[] | null = null;
      while (fr.pos < fe) {
        const t = fr.varint();
        const f = Math.floor(t / 8);
        const ty = t & 7;
        if ((f === 2 || f === 4) && ty === 2) {
          const end = fr.varint() + fr.pos;
          const packed: number[] = [];
          while (fr.pos < end) packed.push(fr.varint());
          if (f === 2) tags = packed;
          else geom = packed;
        } else if (f === 3 && ty === 0) geomType = fr.varint();
        else fr.skip(ty);
      }
      if (geomType !== 2 || !geom) continue;
      const tagMap = new Map<number, number>();
      for (let i = 0; i + 1 < tags.length; i += 2) tagMap.set(tags[i], tags[i + 1]);
      const props = classify((k) => {
        const ki = keyIndex.get(k);
        if (ki === undefined) return null;
        const vi = tagMap.get(ki);
        return vi === undefined ? null : valueAt(vi);
      });
      if (!props) continue;
      const lines: number[][] = [];
      let current: number[] | null = null;
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < geom.length; ) {
        const cmd = geom[i] & 7;
        const count = geom[i] >> 3;
        i += 1;
        if (cmd === 7) continue;
        for (let j = 0; j < count; j += 1) {
          cx += zigzag(geom[i]);
          cy += zigzag(geom[i + 1]);
          i += 2;
          if (cmd === 1) {
            current = [];
            lines.push(current);
          }
          current?.push(cx, cy);
        }
      }
      for (const line of lines) {
        for (const part of clipLine(line, extent)) {
          if (part.length < 4) continue;
          const coordinates: [number, number][] = [];
          for (let i = 0; i < part.length; i += 2) coordinates.push(toLngLat(part[i], part[i + 1], x, y, z, extent));
          roads.push({ coordinates, ...props });
        }
      }
    }
  }
  return roads;
}
