# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-23

### Added

- Hidden Markov model map matching with Viterbi decoding, gap routing, chain pruning, detour straightening and spike and hook removal.
- TypeScript package with ES module, CommonJS and type definition builds.
- PHP 8.2+ port with identical results, verified by shared fixtures.
- `buildNetwork`, `matchPoints`, `matchCoordinates`, `toCoordinates` and `snapToRoad` in both languages.
- Vector tile adapter `route-map-matching/tiles` with a dependency-free MVT decoder for the OpenMapTiles and Protomaps schemas, tile and network caches and concurrent downloads.
- Automatic left-hand-traffic detection for 75 countries and territories, built from Natural Earth, with `isLeftHandTraffic`, `leftHandTrafficFlags` and `leftHandTrafficPolygons`.
- Benchmarks, a documentation site with a live demo and GitHub Actions for CI, releases and Pages.

[Unreleased]: https://github.com/rprasetya/route-map-matching/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rprasetya/route-map-matching/releases/tag/v0.1.0
