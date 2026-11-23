import { METERS_PER_DEGREE } from '../constants';
import type { Position } from '../geo';
import { matchPoints, snapToRoad, toCoordinates, type MatchedPoint, type MatchOptions } from '../match';
import { buildNetwork, type Network, type Road } from '../network';
import { decodeTile, type RoadClassifier } from './decode';

export { decodeTile, DEFAULT_LAYERS, onewayOf } from './decode';
export type { RoadClassifier, DecodeOptions } from './decode';

export interface TileSourceOptions {
  url: string;
  zoom?: number;
  maxTiles?: number;
  margin?: number;
  concurrency?: number;
  timeout?: number;
  tileCacheSize?: number;
  networkCacheSize?: number;
  layers?: Record<string, RoadClassifier>;
  fetch?: (input: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
}

export interface LoadedNetwork {
  network: Network | null;
  complete: boolean;
}

export interface TileMatch {
  matched: MatchedPoint[];
  coordinates: Position[];
  complete: boolean;
}

export interface TileSource {
  tilesFor(coordinates: readonly Position[]): { tiles: string[]; truncated: boolean };
  loadNetwork(coordinates: readonly Position[]): Promise<LoadedNetwork>;
  match(coordinates: readonly Position[], options?: MatchOptions): Promise<TileMatch>;
  snap(coordinates: readonly Position[], radius?: number): Promise<(Position | null)[]>;
}

export const tileX = (lng: number, z: number): number => Math.floor(((lng + 180) / 360) * 2 ** z);
export const tileY = (lat: number, z: number): number => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

export function createTileSource(options: TileSourceOptions): TileSource {
  const zoom = options.zoom ?? 14;
  const maxTiles = options.maxTiles ?? 64;
  const margin = options.margin ?? 250;
  const concurrency = options.concurrency ?? 6;
  const timeout = options.timeout ?? 10000;
  const tileCacheSize = options.tileCacheSize ?? 96;
  const networkCacheSize = options.networkCacheSize ?? 4;
  const doFetch = options.fetch ?? ((input: string, init?: { signal?: AbortSignal }) => globalThis.fetch(input, init));
  const tileCache = new Map<string, Promise<Road[] | null>>();
  const networkCache = new Map<string, LoadedNetwork>();

  const tilesFor = (coordinates: readonly Position[]) => {
    const count = new Map<string, number>();
    const dLat = margin / METERS_PER_DEGREE;
    for (const [lng, lat] of coordinates) {
      const dLng = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
      for (let x = tileX(lng - dLng, zoom); x <= tileX(lng + dLng, zoom); x += 1) {
        for (let y = tileY(lat + dLat, zoom); y <= tileY(lat - dLat, zoom); y += 1) {
          const k = `${x}/${y}`;
          count.set(k, (count.get(k) ?? 0) + 1);
        }
      }
    }
    const tiles = [...count]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxTiles)
      .map(([k]) => k)
      .sort();
    return { tiles, truncated: count.size > maxTiles };
  };

  const loadTile = (key: string): Promise<Road[] | null> => {
    const cached = tileCache.get(key);
    if (cached) {
      tileCache.delete(key);
      tileCache.set(key, cached);
      return cached;
    }
    const [x, y] = key.split('/').map(Number);
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    const url = options.url.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y));
    const promise = doFetch(url, controller ? { signal: controller.signal } : undefined)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((buf) => decodeTile(new Uint8Array(buf), x, y, zoom, { layers: options.layers }))
      .catch(() => {
        tileCache.delete(key);
        return null;
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
      });
    tileCache.set(key, promise);
    while (tileCache.size > tileCacheSize) tileCache.delete(tileCache.keys().next().value!);
    return promise;
  };

  const loadTiles = async (tiles: string[]): Promise<LoadedNetwork> => {
    const key = tiles.join(',');
    const cached = networkCache.get(key);
    if (cached) return cached;
    const roads: Road[] = [];
    let failed = 0;
    for (let i = 0; i < tiles.length; i += concurrency) {
      for (const part of await Promise.all(tiles.slice(i, i + concurrency).map(loadTile))) {
        if (part) for (const r of part) roads.push(r);
        else failed += 1;
      }
    }
    if (tiles.length && failed === tiles.length) throw new Error('Road tiles could not be downloaded');
    const result: LoadedNetwork = { network: roads.length ? buildNetwork(roads) : null, complete: failed === 0 };
    if (failed) return result;
    networkCache.set(key, result);
    while (networkCache.size > networkCacheSize) networkCache.delete(networkCache.keys().next().value!);
    return result;
  };

  return {
    tilesFor,
    async loadNetwork(coordinates) {
      return loadTiles(tilesFor(coordinates).tiles);
    },
    async match(coordinates, matchOptions = {}) {
      if (coordinates.length < 2) return { matched: [], coordinates: [...coordinates], complete: true };
      const { tiles, truncated } = tilesFor(coordinates);
      const { network, complete } = await loadTiles(tiles);
      if (!network) return { matched: [], coordinates: [...coordinates], complete: complete && !truncated };
      const matched = matchPoints(
        coordinates.map(([lng, lat]) => ({ lng, lat })),
        network,
        matchOptions,
      );
      return { matched, coordinates: toCoordinates(matched), complete: complete && !truncated };
    },
    async snap(coordinates, radius) {
      if (!coordinates.length) return [];
      const { network } = await loadTiles(tilesFor(coordinates).tiles);
      return coordinates.map((c) => (network ? snapToRoad(network, c, radius) : null));
    },
  };
}
