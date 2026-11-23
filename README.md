# route-map-matching

Snap noisy GPS traces onto the roads they were driven on. A hidden Markov model with Viterbi decoding, written once in TypeScript and once in PHP, with identical results in the browser, Node.js and PHP. No routing server, no dependencies.

**[Live demo and docs](https://route-map-matching.vercel.app/)**

- Over 100,000 GPS points per second in Node.js 22, 4 to 8 times faster than the production engine it was extracted from, with the same output.
- Handles one-way streets, divided roads, GPS gaps, spikes, detours and false U-turns.
- Knows which side of the road traffic drives on in 75 countries and territories, and uses it by default.
- Reads roads from your own data or straight from Mapbox vector tiles (OpenMapTiles and Protomaps schemas).
- One set of test fixtures runs against both languages in CI, so a trace matches the same way on the client and on the server.

## Install

```bash
npm install route-map-matching
composer require rprasetya/route-map-matching
```

Node.js 18 or newer, any modern browser, or PHP 8.2 or newer. The npm package ships ES modules, CommonJS and type definitions, so it works the same from plain JavaScript, from TypeScript and straight from a CDN.

## Quick start

### JavaScript (ES modules)

Node.js 18 or newer, or any bundler such as Vite, webpack or esbuild:

```js
import { buildNetwork, matchCoordinates, matchPoints } from 'route-map-matching';

const network = buildNetwork([
  { coordinates: [[106.822, -6.175], [106.830, -6.174]], oneway: 1, penalty: 0, factor: 1 },
  [[106.830, -6.174], [106.830, -6.180]],
]);

const route = matchCoordinates(gpsPoints, network);

const detailed = matchPoints(gpsPoints.map(([lng, lat]) => ({ lng, lat })), network, {
  include: (i) => speeds[i] > 2,
});
```

### JavaScript (CommonJS)

```js
const { buildNetwork, matchCoordinates } = require('route-map-matching');
const { createTileSource } = require('route-map-matching/tiles');

const network = buildNetwork(roads);
const route = matchCoordinates(gpsPoints, network);
```

### In the browser without a build step

The files in `dist` are plain ES modules with no dependencies, so a CDN can serve them straight to a `<script type="module">`:

```html
<script type="module">
  import { buildNetwork, matchCoordinates } from 'https://cdn.jsdelivr.net/npm/route-map-matching@1/dist/index.js';
  import { createTileSource } from 'https://cdn.jsdelivr.net/npm/route-map-matching@1/dist/tiles/index.js';

  const network = buildNetwork(roads);
  const route = matchCoordinates(gpsPoints, network);

  const tiles = createTileSource({ url: 'https://tiles.example.org/{z}/{x}/{y}.pbf' });
  const { coordinates } = await tiles.match(gpsPoints);
</script>
```

`isLeftHandTraffic` lives in `dist/traffic-side.js`.

### TypeScript

The package ships its own type definitions, so there is nothing extra to install:

```ts
import { buildNetwork, matchPoints } from 'route-map-matching';
import type { MatchedPoint, MatchOptions, RoadInput } from 'route-map-matching';

const roads: RoadInput[] = [
  { coordinates: [[106.822, -6.175], [106.830, -6.174]], oneway: 1 },
  [[106.830, -6.174], [106.830, -6.180]],
];

const options: MatchOptions = { radius: 60 };
const matched: MatchedPoint[] = matchPoints(
  gpsPoints.map(([lng, lat]) => ({ lng, lat })),
  buildNetwork(roads),
  options,
);
```

Exported types: `Network`, `Road`, `RoadInput`, `Oneway`, `MatchOptions`, `MatchedPoint`, `PointFlags`, `LngLat` and `Position`, plus `TileSource`, `TileSourceOptions`, `TileMatch` and `LoadedNetwork` from `route-map-matching/tiles`.

### PHP

```php
use RouteMapMatching\Matcher;
use RouteMapMatching\Network;

$network = Network::build([
    ['coordinates' => [[106.822, -6.175], [106.830, -6.174]], 'oneway' => 1],
    [[106.830, -6.174], [106.830, -6.180]],
]);

$route = Matcher::matchCoordinates($gpsPoints, $network);
```

### Roads from vector tiles

```ts
import { createTileSource } from 'route-map-matching/tiles';

const tiles = createTileSource({ url: 'https://tiles.example.org/{z}/{x}/{y}.pbf' });
const { coordinates, matched, complete } = await tiles.match(gpsPoints);
```

`createTileSource` picks the tiles a trace passes through, downloads them six at a time, caches tiles and networks, and builds the graph. Use the same tile URL your MapLibre or Mapbox map already loads. `complete` is `false` when a tile failed or the trace needed more than `maxTiles` tiles.

## API

Coordinates are `[lng, lat]` in degrees. Every function exists in JavaScript (with TypeScript types) and in PHP, with the same behaviour.

| JavaScript and TypeScript | PHP | Returns |
|---|---|---|
| `buildNetwork(roads)` | `Network::build($roads)` | A road graph. Build it once and reuse it for many traces. |
| `matchPoints(points, network, options?)` | `Matcher::matchPoints($points, $network, $options)` | One entry per input point. |
| `matchCoordinates(coordinates, network, options?)` | `Matcher::matchCoordinates(...)` | The matched line as `[lng, lat]` pairs. |
| `toCoordinates(matched)` | `Matcher::toCoordinates($matched)` | Flattens `matchPoints` output into a line. |
| `snapToRoad(network, [lng, lat], radius?)` | `Matcher::snapToRoad(...)` | The nearest point on a road within `radius` metres, or `null`. |
| `isLeftHandTraffic(lng, lat)` from `route-map-matching/traffic-side` | `LeftHandTraffic::contains($lng, $lat)` | Whether traffic keeps left there. |
| `leftHandTrafficPolygons()` | `LeftHandTraffic::polygons()` | The regions as GeoJSON polygon coordinates. |
| `createTileSource(options)` from `route-map-matching/tiles` | | Loads roads from vector tiles and matches. |
| `decodeTile(data, x, y, z, { layers })` | | Decodes one tile into roads. |

### Roads

A road is either a plain list of coordinates or an object:

| Field | Default | Meaning |
|---|---|---|
| `coordinates` | | The polyline. |
| `oneway` | `0` | `1` follows the drawing direction, `-1` runs against it. Driving the wrong way costs three times the distance. |
| `penalty` | `0` | Metres added to a candidate's score. Raise it for service roads and tracks. |
| `factor` | `1` | Cost multiplier when routing across gaps. Raise it to prefer main roads. |

Lines that share a vertex, or end within 3 m of another line, are joined automatically.

### Match options

| Option | Default | Meaning |
|---|---|---|
| `radius` | `50` | Search radius in metres. Widens to 100 m and 200 m when nothing is closer. |
| `include` | every point | Booleans or a function `(index) => boolean`. Leave parked or stationary fixes out. |
| `leftHandTraffic` | `'auto'` | Looks up the side of the road per point. Pass `true`, `false`, an array or a function to override. |

### Matched points

| Field | Meaning |
|---|---|
| `index` | Position in the input. |
| `position` | The snapped location, or the original fix when it could not be matched. |
| `path` | Road points to insert before `position`, following the street from the previous point. |
| `skipped` | The point was dropped as a spike, a detour or a duplicate. Leave it out when drawing. |
| `matched` | The point sits on a road. |

## How it works

1. **Candidates.** Up to six positions on nearby road segments per fix, scored by distance, heading, road class, one-way rules and the side traffic keeps to.
2. **Transitions.** A bounded Dijkstra search measures the road distance between candidates of consecutive fixes. Routes close to the straight-line GPS distance score best.
3. **Viterbi.** The cheapest chain of candidates over the whole trace wins.
4. **Clean-up.** Gaps are routed, chains shorter than three points dropped, detours straightened and false U-turns and hooks removed.

The engine started as the road snapping of a fleet tracking product and was tuned there on real trips. This package keeps its behaviour exactly and rewrites the hot paths: typed-array graphs in compressed sparse row form, numeric spatial grid keys, reusable Dijkstra buffers with epoch stamps, a hole-based binary heap and incremental line lengths.

## Performance

Median of seven runs (Node.js) and three runs (PHP) on a laptop: a 40 by 40 block grid with 3,280 segments and 7 m of GPS noise.

| GPS points | Original engine | Node.js 22 | PHP 8.4 | PHP 8.4 with JIT |
|---|---|---|---|---|
| 1,000 | 71 ms | 16 ms | 89 ms | 55 ms |
| 5,000 | 315 ms | 47 ms | 529 ms | 268 ms |
| 20,000 | 1,212 ms | 150 ms | 2,006 ms | 931 ms |

Building the network for the same grid takes about 5 ms in Node.js and 15 ms in PHP. Run `npm run bench` and `composer bench <scenario.json>` on your own machine.

## Traffic side

On a divided road the two carriageways are often closer together than the GPS error. Where traffic keeps left, the matcher leans towards the left carriageway; elsewhere it stays neutral. The regions are built by `scripts/build-traffic-side.py` from Natural Earth 1:10m countries: left-hand-traffic territories widened 0.15 degrees out to sea, minus the land of right-hand-traffic countries, so coastal roads stay inside and land borders stay sharp. The data is 45 KB (32 KB gzipped) and a lookup takes about 2 µs.

## Development

```bash
npm install
npm test              # TypeScript tests and shared fixtures
npm run typecheck
npm run build
composer install
vendor/bin/phpunit    # PHP tests and the same fixtures
npm run site:dev      # documentation site with the live demo
```

`npm run fixtures` regenerates `tests/fixtures` from the built library. Set `REFERENCE` to another engine's module to generate them from that engine instead.

## Versioning

Releases follow [Semantic Versioning](https://semver.org). Every release is a `vX.Y.Z` tag with notes in [CHANGELOG.md](CHANGELOG.md). Pushing the tag runs the tests, creates the GitHub release and publishes to npm; Packagist reads the same tag.

## Credits

Map data in the demo © OpenStreetMap contributors, served by OpenFreeMap with the OpenMapTiles schema. Country borders from Natural Earth (public domain).

## License

MIT © Raya Prasetya
