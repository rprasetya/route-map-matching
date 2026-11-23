<?php

declare(strict_types=1);

namespace RouteMapMatching;

use WeakMap;

final class Matcher
{
    private static ?WeakMap $tools = null;

    private static function tools(Network $net): array
    {
        self::$tools ??= new WeakMap();
        if (!isset(self::$tools[$net])) {
            self::$tools[$net] = [new CandidateFinder($net), new Search($net)];
        }

        return self::$tools[$net];
    }

    private static function flag(mixed $value, bool $fallback): \Closure
    {
        if ($value === null) {
            return static fn (int $i): bool => $fallback;
        }
        if (is_bool($value)) {
            return static fn (int $i): bool => $value;
        }
        if (is_callable($value)) {
            return static fn (int $i): bool => (bool) $value($i);
        }

        return static fn (int $i): bool => isset($value[$i]) ? $value[$i] !== false : $fallback;
    }

    private static function emission(Candidate $m): float
    {
        $r = $m->score / Config::SIGMA_M;

        return ($r * $r) / 2;
    }

    private static function startChain(array $cands): array
    {
        $out = [];
        foreach ($cands as $m) {
            $out[] = new State($m, self::emission($m), -1, -1, -1, null);
        }

        return $out;
    }

    private static function trimSpikes(array $start, array $path, array $end): array
    {
        $pts = [$start, ...$path, $end];
        for ($i = 1; $i < count($pts) - 1;) {
            if (Geo::reverses($pts[$i - 1], $pts[$i], $pts[$i + 1])) {
                array_splice($pts, $i, 1);
                $i = max(1, $i - 1);
            } else {
                $i++;
            }
        }
        for ($i = 0; $i < count($pts) - 2; $i++) {
            $walked = 0.0;
            $stop = min(count($pts), $i + 1 + Config::HOOK_NODES);
            for ($j = $i + 1; $j < $stop; $j++) {
                $walked += Geo::distance($pts[$j - 1][0], $pts[$j - 1][1], $pts[$j][0], $pts[$j][1]);
                if ($j > $i + 1) {
                    $gap = Geo::distance($pts[$i][0], $pts[$i][1], $pts[$j][0], $pts[$j][1]);
                    if ($gap < Config::HOOK_M && $walked > $gap * 3 + Config::HOOK_M) {
                        array_splice($pts, $i + 1, $j - $i - 1);
                        break;
                    }
                }
            }
        }

        return array_slice($pts, 1, -1);
    }

    private static function normalize(array $points): array
    {
        $out = [];
        foreach ($points as $p) {
            $out[] = isset($p['lng']) ? [(float) $p['lng'], (float) $p['lat']] : [(float) $p[0], (float) $p[1]];
        }

        return $out;
    }

    public static function matchPoints(array $points, Network $network, array $options = []): array
    {
        $pts = self::normalize($points);
        $n = count($pts);
        if ($n === 0) {
            return [];
        }
        $radius = (float) ($options['radius'] ?? Config::RADIUS_M);
        $include = self::flag($options['include'] ?? null, true);
        $side = $options['leftHandTraffic'] ?? 'auto';
        $leftHand = self::flag($side === 'auto' ? LeftHandTraffic::flags($pts) : $side, false);
        [$finder, $search] = self::tools($network);
        $cos = [];
        $step = [0.0];
        for ($i = 0; $i < $n; $i++) {
            $cos[$i] = cos($pts[$i][1] * Config::RAD);
            if ($i > 0) {
                $step[$i] = Geo::distance($pts[$i - 1][0], $pts[$i - 1][1], $pts[$i][0], $pts[$i][1]);
            }
        }
        $includeAt = [];
        for ($i = 0; $i < $n; $i++) {
            $includeAt[$i] = $include($i);
        }

        $layers = [];
        $last = -1;
        for ($i = 0; $i < $n; $i++) {
            $p = $pts[$i];
            if (!$includeAt[$i]) {
                $layers[] = [];
                $last = -1;
                continue;
            }
            $from = $i > 0 ? $pts[$i - 1] : $p;
            $to = $i > 0 ? $p : ($pts[1] ?? null);
            $length = $to !== null ? Geo::distance($from[0], $from[1], $to[0], $to[1]) : 0.0;
            $dir = null;
            if ($length >= Config::HEADING_MIN_M) {
                $c = cos((($from[1] + $to[1]) / 2) * Config::RAD);
                $dx = ($to[0] - $from[0]) * $c;
                $dy = $to[1] - $from[1];
                $len = sqrt($dx * $dx + $dy * $dy);
                if ($len > 0) {
                    $dir = [$dx / $len, $dy / $len];
                }
            }
            $left = $leftHand($i);
            $confident = $length >= Config::HEADING_CONFIDENT_M;
            $cands = $finder->find($p[0], $p[1], $cos[$i], $dir, $radius, $left, $confident);
            foreach (Config::WIDE_RADII_M as $r) {
                if ($cands || $r <= $radius) {
                    break;
                }
                $cands = $finder->find($p[0], $p[1], $cos[$i], $dir, $r, $left, $confident);
            }
            if (!$cands) {
                $layers[] = [];
                if ($last >= 0 && $i - $last > Config::MAX_SKIPPED) {
                    $last = -1;
                }
                continue;
            }
            if ($last < 0) {
                $layers[] = self::startChain($cands);
                $last = $i;
                continue;
            }
            $straight = 0.0;
            for ($j = $last + 1; $j <= $i; $j++) {
                $straight += $step[$j];
            }
            if ($straight > Config::BREAK_M) {
                $layers[] = self::startChain($cands);
                $last = $i;
                continue;
            }
            $before = $layers[$last];
            $limit = max($straight * Config::DETOUR_FACTOR, $straight + Config::DETOUR_EXTRA_M);
            $candCount = count($cands);
            $best = array_fill(0, $candCount, null);
            $emissions = [];
            foreach ($cands as $c => $m) {
                $emissions[$c] = self::emission($m);
            }
            foreach ($before as $j => $s) {
                $search->run($s->m, $limit, false, $cands);
                for ($c = 0; $c < $candCount; $c++) {
                    $m = $cands[$c];
                    $routeLength = $search->routeTo($m);
                    if ($routeLength > $limit) {
                        continue;
                    }
                    $cost = $s->cost + abs($routeLength - $straight) / Config::BETA_M + $emissions[$c];
                    $cur = $best[$c];
                    if ($cur === null || $cost < $cur->cost) {
                        $node = $search->routeNode;
                        $best[$c] = new State($m, $cost, $last, $j, $node, $node >= 0 ? $search->pathNodes($node) : null);
                    }
                }
            }
            $row = [];
            foreach ($best as $s) {
                if ($s !== null) {
                    $row[] = $s;
                }
            }
            $layers[] = $row ?: self::startChain($cands);
            $last = $i;
        }

        $chosen = array_fill(0, $n, null);
        $skipped = array_fill(0, $n, false);
        for ($i = $n - 1; $i >= 0;) {
            $layer = $layers[$i];
            if (!$layer) {
                $i--;
                continue;
            }
            $idx = 0;
            $layerCount = count($layer);
            for ($j = 1; $j < $layerCount; $j++) {
                if ($layer[$j]->cost < $layer[$idx]->cost) {
                    $idx = $j;
                }
            }
            while (true) {
                $s = $layers[$i][$idx];
                $chosen[$i] = $s;
                if ($s->from < 0) {
                    break;
                }
                for ($j = $s->from + 1; $j < $i; $j++) {
                    $skipped[$j] = true;
                }
                $idx = $s->prev;
                $i = $s->from;
            }
            $i--;
        }

        $chain = array_fill(0, $n, -1);
        $chainSize = [];
        for ($i = 0; $i < $n; $i++) {
            $s = $chosen[$i];
            if ($s === null) {
                continue;
            }
            if ($s->from >= 0) {
                $chain[$i] = $chain[$s->from];
                for ($j = $s->from + 1; $j < $i; $j++) {
                    $chain[$j] = $chain[$i];
                }
            } else {
                $chain[$i] = count($chainSize);
                $chainSize[] = 0;
            }
            $chainSize[$chain[$i]]++;
        }
        for ($i = 0; $i < $n; $i++) {
            if ($chain[$i] < 0 || $chainSize[$chain[$i]] >= Config::MIN_CHAIN) {
                continue;
            }
            $chosen[$i] = null;
            $skipped[$i] = false;
        }

        $nodeLng = $network->nodeLng;
        $nodeLat = $network->nodeLat;
        $inserted = [];
        for ($i = 0; $i < $n; $i++) {
            $s = $chosen[$i];
            if ($s !== null && $s->from >= 0 && $s->node >= 0) {
                $route = [];
                foreach ($s->route as $node) {
                    $route[] = [$nodeLng[$node], $nodeLat[$node]];
                }
                $inserted[$i] = self::trimSpikes($chosen[$s->from]->m->at, $route, $s->m->at);
            } else {
                $inserted[$i] = [];
            }
        }

        $fillGap = static function (int $p, int $q) use (&$chosen, &$skipped, &$inserted, $step, $search): void {
            $raw = 0.0;
            for ($j = $p + 1; $j <= $q; $j++) {
                $raw += $step[$j];
            }
            $start = $chosen[$p]->m;
            $end = $chosen[$q]->m;
            $snapped = Geo::distance($start->lng, $start->lat, $end->lng, $end->lat);
            if (($q === $p + 1 && $raw < Config::GAP_MIN_M && $snapped < Config::GAP_MIN_M) || $raw > Config::GAP_MAX_M) {
                return;
            }
            $limit = max($raw * Config::GAP_FACTOR + Config::GAP_EXTRA_M, $snapped * Config::GAP_SNAPPED_FACTOR + Config::GAP_SNAPPED_EXTRA_M);
            $search->run($start, $limit * Config::WEIGHT_FACTOR_MAX, true, [$end]);
            $routeLength = $search->routeTo($end);
            if (!is_finite($routeLength)) {
                return;
            }
            $node = $search->routeNode;
            $path = $node >= 0 ? $search->path($node) : [];
            if (Geo::lengthThrough($start->at, $path, $end->at) > $limit) {
                return;
            }
            for ($j = $p + 1; $j < $q; $j++) {
                $skipped[$j] = true;
            }
            $inserted[$q] = self::trimSpikes($start->at, $path, $end->at);
        };

        $connected = [];
        for ($i = 0; $i < $n; $i++) {
            $connected[$i] = $chosen[$i] !== null && $chosen[$i]->from >= 0;
        }
        $connect = static function () use (&$chosen, &$skipped, &$connected, $includeAt, $n, $fillGap): void {
            $prev = -1;
            for ($q = 0; $q < $n; $q++) {
                if (!$includeAt[$q]) {
                    $prev = -1;
                    continue;
                }
                if ($chosen[$q] === null || $skipped[$q]) {
                    continue;
                }
                if ($prev >= 0 && !$connected[$q]) {
                    $fillGap($prev, $q);
                    $connected[$q] = true;
                }
                $prev = $q;
            }
        };
        $connect();
        for ($i = 0; $i < $n; $i++) {
            if (!$includeAt[$i] || $chosen[$i] !== null || $skipped[$i]) {
                continue;
            }
            $p = $pts[$i];
            foreach ([$radius, ...Config::WIDE_RADII_M] as $r) {
                $found = $finder->find($p[0], $p[1], $cos[$i], null, $r);
                if (!$found) {
                    continue;
                }
                $chosen[$i] = new State($found[0], 0.0, -1, -1, -1, null);
                break;
            }
        }
        $connect();

        $snapDistance = array_fill(0, $n, 0.0);
        for ($k = 0; $k < $n; $k++) {
            $s = $chosen[$k];
            if ($s !== null) {
                $snapDistance[$k] = Geo::distance($pts[$k][0], $pts[$k][1], $s->m->lng, $s->m->lat);
            }
        }
        $badState = array_fill(0, $n, 0);
        $bad = static function (int $k) use (&$badState, &$chosen, &$skipped, &$inserted, $snapDistance, $pts): bool {
            $cached = $badState[$k];
            if ($cached) {
                return $cached === 2;
            }
            $s = $chosen[$k];
            if ($s === null || $skipped[$k]) {
                $result = true;
            } elseif ($snapDistance[$k] > Config::BAD_M) {
                $result = true;
            } elseif ($s->from < 0 || $chosen[$s->from] === null) {
                $result = false;
            } else {
                $result = Geo::lengthThrough($chosen[$s->from]->m->at, $inserted[$k], $s->m->at) > Geo::distance($pts[$s->from][0], $pts[$s->from][1], $pts[$k][0], $pts[$k][1]) * 1.5 + Config::BAD_M;
            }
            $badState[$k] = $result ? 2 : 1;

            return $result;
        };
        $next = static function (int $i) use (&$chosen, &$skipped, $includeAt, $n): int {
            for ($k = $i + 1; $k < $n; $k++) {
                if ($includeAt[$k] && $chosen[$k] !== null && !$skipped[$k]) {
                    return $k;
                }
            }

            return -1;
        };

        for ($i = $next(-1); $i >= 0;) {
            $hasBad = false;
            $ahead = 0.0;
            for ($k = $i + 1; $k < $n && $includeAt[$k]; $k++) {
                $ahead += $step[$k];
                if ($ahead > Config::LOOKAHEAD_M) {
                    break;
                }
                if ($bad($k)) {
                    $hasBad = true;
                    break;
                }
            }
            if (!$hasBad) {
                $i = $next($i);
                continue;
            }
            $windowLength = 0.0;
            $targets = [];
            for ($k = $i + 1; $k < $n && $includeAt[$k]; $k++) {
                $windowLength += $step[$k];
                if ($windowLength > Config::STRAIGHTEN_MAX_M) {
                    break;
                }
                if ($chosen[$k] !== null && !$skipped[$k]) {
                    $targets[] = $chosen[$k]->m;
                }
            }
            $origin = $chosen[$i]->m;
            $search->run($origin, min(Config::STRAIGHTEN_WEIGHT_MAX, min($windowLength, Config::STRAIGHTEN_MAX_M) * 2 + 300), true, $targets);
            $bestJ = -1;
            $bestPath = [];
            $raw = 0.0;
            $currentLength = 0.0;
            $currentLast = $origin->at;
            $errorTotal = 0.0;
            for ($j = $i + 1; $j < $n; $j++) {
                if (!$includeAt[$j]) {
                    break;
                }
                $raw += $step[$j];
                if ($raw > Config::STRAIGHTEN_MAX_M) {
                    break;
                }
                if ($j > $i + 1) {
                    $prevK = $j - 1;
                    $errorTotal += $chosen[$prevK] !== null && !$skipped[$prevK] ? $snapDistance[$prevK] : Config::UNMATCHED_ERROR_M;
                }
                if (!$skipped[$j]) {
                    $sj = $chosen[$j];
                    if ($sj !== null) {
                        foreach ($inserted[$j] as $q) {
                            $currentLength += Geo::distance($currentLast[0], $currentLast[1], $q[0], $q[1]);
                            $currentLast = $q;
                        }
                        $currentLength += Geo::distance($currentLast[0], $currentLast[1], $sj->m->lng, $sj->m->lat);
                        $currentLast = $sj->m->at;
                    } else {
                        $currentLength += Geo::distance($currentLast[0], $currentLast[1], $pts[$j][0], $pts[$j][1]);
                        $currentLast = $pts[$j];
                    }
                }
                $target = $chosen[$j];
                if ($target === null || $skipped[$j] || $j === $i + 1) {
                    continue;
                }
                $routeLength = $search->routeTo($target->m);
                $node = $search->routeNode;
                if (!is_finite($routeLength) || $search->wrongWay($target->m, $node)) {
                    continue;
                }
                $path = $node >= 0 ? $search->path($node) : [];
                if ($currentLength < Geo::lengthThrough($origin->at, $path, $target->m->at) * Config::STRAIGHTEN_SAVING + Config::STRAIGHTEN_SAVING_M) {
                    continue;
                }
                $tolerance = min(Config::TOLERANCE_MAX_M, max(Config::TOLERANCE_MIN_M, ($errorTotal / ($j - $i - 1)) * Config::TOLERANCE_FACTOR));
                $line = [$origin->at, ...$path, $target->m->at];
                $lineCount = count($line);
                $fits = true;
                $nearSegment = 1;
                for ($k = $i + 1; $k < $j && $fits; $k++) {
                    $pLng = $pts[$k][0];
                    $pLat = $pts[$k][1];
                    $cosP = $cos[$k];
                    $near = false;
                    for ($scan = 0, $q = $nearSegment; $scan < $lineCount - 1; $scan++, $q = $q + 1 < $lineCount ? $q + 1 : 1) {
                        $aLng = $line[$q - 1][0];
                        $aLat = $line[$q - 1][1];
                        $bLng = $line[$q][0];
                        $bLat = $line[$q][1];
                        $ax = $aLng * $cosP;
                        $dx = $bLng * $cosP - $ax;
                        $dy = $bLat - $aLat;
                        $pj = $dx * $dx + $dy * $dy;
                        $t = $pj > 0 ? max(0.0, min(1.0, (($pLng * $cosP - $ax) * $dx + ($pLat - $aLat) * $dy) / $pj)) : 0.0;
                        $qLng = $aLng + ($bLng - $aLng) * $t;
                        $qLat = $aLat + ($bLat - $aLat) * $t;
                        $c2 = cos((($pLat + $qLat) / 2) * Config::RAD);
                        $ex = ($qLng - $pLng) * $c2 * Config::METERS_PER_DEGREE;
                        $ey = ($qLat - $pLat) * Config::METERS_PER_DEGREE;
                        if (sqrt($ex * $ex + $ey * $ey) <= $tolerance) {
                            $near = true;
                            $nearSegment = $q;
                            break;
                        }
                    }
                    if (!$near) {
                        $fits = false;
                    }
                }
                if ($fits) {
                    $bestJ = $j;
                    $bestPath = $path;
                }
            }
            if ($bestJ < 0) {
                $i = $next($i);
                continue;
            }
            for ($k = $i + 1; $k < $bestJ; $k++) {
                $skipped[$k] = true;
            }
            $inserted[$bestJ] = self::trimSpikes($origin->at, $bestPath, $chosen[$bestJ]->m->at);
            for ($k = $i + 1; $k <= $bestJ; $k++) {
                $badState[$k] = 0;
            }
            $i = $bestJ;
        }

        $out = [];
        for ($i = 0; $i < $n; $i++) {
            $s = $chosen[$i];
            if ($skipped[$i]) {
                $out[$i] = ['index' => $i, 'position' => $pts[$i], 'path' => [], 'skipped' => true, 'matched' => false, 'm' => null];
            } elseif ($s === null) {
                $out[$i] = ['index' => $i, 'position' => $pts[$i], 'path' => [], 'skipped' => false, 'matched' => false, 'm' => null];
            } else {
                $out[$i] = ['index' => $i, 'position' => $s->m->at, 'path' => $inserted[$i], 'skipped' => false, 'matched' => true, 'm' => $s->m];
            }
        }

        $routeBetween = static function (array $a, array $c, array $current) use ($search): ?array {
            if ($a['m'] === null || $c['m'] === null) {
                return null;
            }
            $straight = Geo::distance($a['position'][0], $a['position'][1], $c['position'][0], $c['position'][1]);
            $search->run($a['m'], ($straight * Config::GAP_FACTOR + Config::GAP_EXTRA_M) * Config::WEIGHT_FACTOR_MAX, true, [$c['m']]);
            $routeLength = $search->routeTo($c['m']);
            $node = $search->routeNode;
            if (!is_finite($routeLength) || $search->wrongWay($c['m'], $node)) {
                return null;
            }
            $path = $node >= 0 ? $search->path($node) : [];

            return Geo::lengthThrough($a['position'], $path, $c['position']) < Geo::lineLength($current) ? $path : null;
        };

        $a = null;
        for ($i = 0; $i < $n; $i++) {
            $h = $out[$i];
            if ($h['skipped']) {
                continue;
            }
            $ic = $i + 1;
            while ($ic < $n && $out[$ic]['skipped']) {
                $ic++;
            }
            $c = $ic < $n ? $out[$ic] : null;
            if ($a !== null && $c !== null && $h['matched'] && $a['matched'] && $c['matched']) {
                $before = [$a['position'], ...$h['path']];
                $after = [...$c['path'], $c['position']];
                $hu = -1;
                $hv = -1;
                $afterCount = count($after);
                for ($u = count($before) - 1; $u >= 0 && $hu < 0; $u--) {
                    $ahead = [...array_slice($before, $u + 1), $h['position']];
                    for ($v = 0; $v < $afterCount && $hu < 0; $v++) {
                        $d = Geo::distance($before[$u][0], $before[$u][1], $after[$v][0], $after[$v][1]);
                        if ($d < Config::HOOK_M && Geo::lineLength([$before[$u], ...$ahead, ...array_slice($after, 0, $v + 1)]) > $d * 3 + Config::HOOK_M) {
                            $hu = $u;
                            $hv = $v;
                        }
                    }
                }
                if ($hu >= 0) {
                    $out[$i] = ['skipped' => true] + $h;
                    $c['path'] = self::trimSpikes($a['position'], [...array_slice($before, 1, $hu), ...array_slice($after, $hv, -1)], $c['position']);
                    $out[$ic] = $c;
                    continue;
                }
                $enter = $h['path'] ? $h['path'][count($h['path']) - 1] : $a['position'];
                $exit = $c['path'] ? $c['path'][0] : $c['position'];
                $leg = min(
                    Geo::distance($enter[0], $enter[1], $h['position'][0], $h['position'][1]),
                    Geo::distance($h['position'][0], $h['position'][1], $exit[0], $exit[1]),
                );
                if ($leg < Config::REVERSAL_M && Geo::reverses($enter, $h['position'], $exit)) {
                    if ($leg < Config::JITTER_M) {
                        $out[$i] = ['skipped' => true] + $h;
                        $c['path'] = self::trimSpikes($a['position'], [...$h['path'], ...$c['path']], $c['position']);
                        $out[$ic] = $c;
                        continue;
                    }
                    $path = $routeBetween($a, $c, [$a['position'], ...$h['path'], $h['position'], ...$c['path'], $c['position']]);
                    if ($path !== null) {
                        $out[$i] = ['skipped' => true] + $h;
                        $c['path'] = self::trimSpikes($a['position'], $path, $c['position']);
                        $out[$ic] = $c;
                        continue;
                    }
                }
            }
            $a = $h;
        }

        $result = [];
        foreach ($out as $d) {
            $result[] = [
                'index' => $d['index'],
                'position' => $d['position'],
                'path' => $d['path'],
                'skipped' => $d['skipped'],
                'matched' => $d['matched'] && !$d['skipped'],
            ];
        }

        return $result;
    }

    public static function toCoordinates(array $matched): array
    {
        $out = [];
        foreach ($matched as $m) {
            if ($m['skipped']) {
                continue;
            }
            foreach ($m['path'] as $q) {
                $out[] = $q;
            }
            $out[] = $m['position'];
        }

        return $out;
    }

    public static function matchCoordinates(array $coordinates, Network $network, array $options = []): array
    {
        return $coordinates ? self::toCoordinates(self::matchPoints($coordinates, $network, $options)) : [];
    }

    public static function snapToRoad(Network $network, array $position, float $radius = Config::RADIUS_M): ?array
    {
        [$lng, $lat] = [(float) $position[0], (float) $position[1]];
        $found = self::tools($network)[0]->find($lng, $lat, cos($lat * Config::RAD), null, $radius);

        return $found ? [$found[0]->lng, $found[0]->lat] : null;
    }
}
