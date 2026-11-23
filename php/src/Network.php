<?php

declare(strict_types=1);

namespace RouteMapMatching;

final class Network
{
    public int $nodeCount = 0;
    public array $nodeLng = [];
    public array $nodeLat = [];
    public array $arcStart = [];
    public array $arcNode = [];
    public array $arcDistance = [];
    public array $arcWeight = [];
    public int $edgeCount = 0;
    public array $edgeA = [];
    public array $edgeB = [];
    public array $edgeLength = [];
    public array $edgePenalty = [];
    public array $edgeFactor = [];
    public array $edgeForward = [];
    public array $edgeBackward = [];
    public array $edgeOneway = [];
    public array $edgeDirX = [];
    public array $edgeDirY = [];
    public array $edgeHasDir = [];
    public array $cells = [];

    public static function cellKey(int $gx, int $gy): int
    {
        return ($gx + 16777216) * 33554432 + ($gy + 16777216);
    }

    private static function pairKey(int $a, int $b): int
    {
        return $a < $b ? $a * 67108864 + $b : $b * 67108864 + $a;
    }

    private static function cellsOf(float $aLng, float $aLat, float $bLng, float $bLat): array
    {
        $x0 = (int) floor(min($aLng, $bLng) / Config::CELL);
        $x1 = (int) floor(max($aLng, $bLng) / Config::CELL);
        $y0 = (int) floor(min($aLat, $bLat) / Config::CELL);
        $y1 = (int) floor(max($aLat, $bLat) / Config::CELL);
        $keys = [];
        for ($gx = $x0; $gx <= $x1; $gx++) {
            for ($gy = $y0; $gy <= $y1; $gy++) {
                $keys[] = self::cellKey($gx, $gy);
            }
        }

        return $keys;
    }

    public static function build(iterable $roads): self
    {
        $lngs = [];
        $lats = [];
        $nodeCells = [];
        $nodeAt = static function (float $lng, float $lat) use (&$lngs, &$lats, &$nodeCells): int {
            $gx = (int) floor($lng / Config::NODE_CELL);
            $gy = (int) floor($lat / Config::NODE_CELL);
            for ($x = $gx - 1; $x <= $gx + 1; $x++) {
                for ($y = $gy - 1; $y <= $gy + 1; $y++) {
                    $list = $nodeCells[self::cellKey($x, $y)] ?? null;
                    if ($list === null) {
                        continue;
                    }
                    foreach ($list as $n) {
                        if (Geo::distance($lngs[$n], $lats[$n], $lng, $lat) <= Config::MERGE_M) {
                            return $n;
                        }
                    }
                }
            }
            $n = count($lngs);
            $lngs[] = $lng;
            $lats[] = $lat;
            $nodeCells[self::cellKey($gx, $gy)][] = $n;

            return $n;
        };

        $pieceA = [];
        $pieceB = [];
        $piecePenalty = [];
        $pieceFactor = [];
        $pieceOneway = [];
        $pieceSplits = [];
        $pairs = [];
        $degree = [];
        foreach ($roads as $road) {
            $plain = !isset($road['coordinates']);
            $line = $plain ? $road : $road['coordinates'];
            $penalty = $plain ? 0.0 : (float) ($road['penalty'] ?? 0);
            $factor = $plain ? 1.0 : (float) ($road['factor'] ?? 1);
            $oneway = $plain ? 0 : (int) ($road['oneway'] ?? 0);
            $count = count($line);
            for ($i = 1; $i < $count; $i++) {
                $a = $nodeAt((float) $line[$i - 1][0], (float) $line[$i - 1][1]);
                $b = $nodeAt((float) $line[$i][0], (float) $line[$i][1]);
                $key = self::pairKey($a, $b);
                if ($a === $b || isset($pairs[$key])) {
                    continue;
                }
                $pairs[$key] = true;
                $pieceA[] = $a;
                $pieceB[] = $b;
                $piecePenalty[] = $penalty;
                $pieceFactor[] = $factor;
                $pieceOneway[] = $oneway;
                $pieceSplits[] = null;
                $degree[$a] = ($degree[$a] ?? 0) + 1;
                $degree[$b] = ($degree[$b] ?? 0) + 1;
            }
        }

        $pieceCells = [];
        $pieceCount = count($pieceA);
        for ($p = 0; $p < $pieceCount; $p++) {
            foreach (self::cellsOf($lngs[$pieceA[$p]], $lats[$pieceA[$p]], $lngs[$pieceB[$p]], $lats[$pieceB[$p]]) as $key) {
                $pieceCells[$key][] = $p;
            }
        }
        foreach ($degree as $n => $d) {
            if ($d !== 1) {
                continue;
            }
            $nLng = $lngs[$n];
            $nLat = $lats[$n];
            $cosN = cos($nLat * Config::RAD);
            $gx = (int) floor($nLng / Config::CELL);
            $gy = (int) floor($nLat / Config::CELL);
            $bestPiece = -1;
            $bestT = 0.0;
            $bestD = INF;
            for ($x = $gx - 1; $x <= $gx + 1; $x++) {
                for ($y = $gy - 1; $y <= $gy + 1; $y++) {
                    foreach ($pieceCells[self::cellKey($x, $y)] ?? [] as $p) {
                        $a = $pieceA[$p];
                        $b = $pieceB[$p];
                        if ($a === $n || $b === $n) {
                            continue;
                        }
                        $d2 = Geo::project($nLng, $nLat, $cosN, $lngs[$a], $lats[$a], $lngs[$b], $lats[$b]);
                        $t = Geo::$t;
                        if ($d2 > Config::JOIN_M || $t <= 0 || $t >= 1) {
                            continue;
                        }
                        if ($bestPiece < 0 || $d2 < $bestD) {
                            $bestPiece = $p;
                            $bestT = $t;
                            $bestD = $d2;
                        }
                    }
                }
            }
            if ($bestPiece >= 0) {
                $pieceSplits[$bestPiece][] = [$bestT, $n];
            }
        }

        $net = new self();
        $edgeA = [];
        $edgeB = [];
        $edgeLength = [];
        $edgePenalty = [];
        $edgeFactor = [];
        $edgeForward = [];
        $edgeBackward = [];
        $edgeOneway = [];
        $linked = [];
        $addEdge = static function (int $a, int $b, float $penalty, float $factor, int $oneway) use (&$edgeA, &$edgeB, &$edgeLength, &$edgePenalty, &$edgeFactor, &$edgeForward, &$edgeBackward, &$edgeOneway, &$linked, &$lngs, &$lats): void {
            $key = self::pairKey($a, $b);
            if ($a === $b || isset($linked[$key])) {
                return;
            }
            $linked[$key] = true;
            $edgeA[] = $a;
            $edgeB[] = $b;
            $edgeLength[] = Geo::distance($lngs[$a], $lats[$a], $lngs[$b], $lats[$b]);
            $edgePenalty[] = $penalty;
            $edgeFactor[] = $factor;
            $edgeForward[] = $oneway < 0 ? Config::WRONG_WAY_FACTOR : 1.0;
            $edgeBackward[] = $oneway > 0 ? Config::WRONG_WAY_FACTOR : 1.0;
            $edgeOneway[] = $oneway;
        };
        for ($p = 0; $p < $pieceCount; $p++) {
            $splits = $pieceSplits[$p];
            if ($splits === null) {
                $addEdge($pieceA[$p], $pieceB[$p], $piecePenalty[$p], $pieceFactor[$p], $pieceOneway[$p]);
                continue;
            }
            usort($splits, static fn (array $x, array $y): int => $x[0] <=> $y[0]);
            $order = [$pieceA[$p]];
            foreach ($splits as $s) {
                $order[] = $s[1];
            }
            $order[] = $pieceB[$p];
            $orderCount = count($order);
            for ($i = 1; $i < $orderCount; $i++) {
                $addEdge($order[$i - 1], $order[$i], $piecePenalty[$p], $pieceFactor[$p], $pieceOneway[$p]);
            }
        }

        $nodeCount = count($lngs);
        $edgeCount = count($edgeA);
        $arcStart = array_fill(0, $nodeCount + 1, 0);
        for ($e = 0; $e < $edgeCount; $e++) {
            $arcStart[$edgeA[$e] + 1]++;
            $arcStart[$edgeB[$e] + 1]++;
        }
        for ($n = 0; $n < $nodeCount; $n++) {
            $arcStart[$n + 1] += $arcStart[$n];
        }
        $fill = array_slice($arcStart, 0, $nodeCount);
        $arcTotal = $edgeCount * 2;
        $arcNode = $arcTotal ? array_fill(0, $arcTotal, 0) : [];
        $arcDistance = $arcTotal ? array_fill(0, $arcTotal, 0.0) : [];
        $arcWeight = $arcTotal ? array_fill(0, $arcTotal, 0.0) : [];
        $dirX = $edgeCount ? array_fill(0, $edgeCount, 0.0) : [];
        $dirY = $edgeCount ? array_fill(0, $edgeCount, 0.0) : [];
        $hasDir = $edgeCount ? array_fill(0, $edgeCount, false) : [];
        $cells = [];
        for ($e = 0; $e < $edgeCount; $e++) {
            $a = $edgeA[$e];
            $b = $edgeB[$e];
            $d = $edgeLength[$e];
            $i = $fill[$a]++;
            $arcNode[$i] = $b;
            $arcDistance[$i] = $d * $edgeForward[$e];
            $arcWeight[$i] = $d * $edgeFactor[$e] * $edgeForward[$e];
            $i = $fill[$b]++;
            $arcNode[$i] = $a;
            $arcDistance[$i] = $d * $edgeBackward[$e];
            $arcWeight[$i] = $d * $edgeFactor[$e] * $edgeBackward[$e];
            $cos = cos((($lats[$a] + $lats[$b]) / 2) * Config::RAD);
            $dx = ($lngs[$b] - $lngs[$a]) * $cos;
            $dy = $lats[$b] - $lats[$a];
            $len = sqrt($dx * $dx + $dy * $dy);
            if ($len > 0) {
                $dirX[$e] = $dx / $len;
                $dirY[$e] = $dy / $len;
                $hasDir[$e] = true;
            }
            foreach (self::cellsOf($lngs[$a], $lats[$a], $lngs[$b], $lats[$b]) as $key) {
                $cells[$key][] = $e;
            }
        }

        $net->nodeCount = $nodeCount;
        $net->nodeLng = $lngs;
        $net->nodeLat = $lats;
        $net->arcStart = $arcStart;
        $net->arcNode = $arcNode;
        $net->arcDistance = $arcDistance;
        $net->arcWeight = $arcWeight;
        $net->edgeCount = $edgeCount;
        $net->edgeA = $edgeA;
        $net->edgeB = $edgeB;
        $net->edgeLength = $edgeLength;
        $net->edgePenalty = $edgePenalty;
        $net->edgeFactor = $edgeFactor;
        $net->edgeForward = $edgeForward;
        $net->edgeBackward = $edgeBackward;
        $net->edgeOneway = $edgeOneway;
        $net->edgeDirX = $dirX;
        $net->edgeDirY = $dirY;
        $net->edgeHasDir = $hasDir;
        $net->cells = $cells;

        return $net;
    }
}
