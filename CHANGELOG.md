# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-23

### Added

- Hidden Markov model map matching with Viterbi decoding, gap routing, chain pruning, detour straightening and spike and hook removal.
- JavaScript and TypeScript package with ES module, CommonJS and type definition builds, usable from Node.js, bundlers or a CDN script tag with no build step.
- PHP 8.2+ port with identical results, verified by shared fixtures.
- `buildNetwork`, `matchPoints`, `matchCoordinates`, `toCoordinates` and `snapToRoad` in both languages.
- Vector tile adapter `route-map-matching/tiles` with a dependency-free MVT decoder for the OpenMapTiles and Protomaps schemas, tile and network caches and concurrent downloads.
- Automatic left-hand-traffic detection for 75 countries and territories, built from Natural Earth, with `isLeftHandTraffic`, `leftHandTrafficFlags` and `leftHandTrafficPolygons`.
- Benchmarks, GitHub Actions for CI and releases, and a documentation site at https://route-map-matching.vercel.app/ in eight languages with a live demo where you can simulate a drive or place your own GPS points.

[Unreleased]: https://github.com/rprasetya/route-map-matching/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/rprasetya/route-map-matching/releases/tag/v1.0.0
