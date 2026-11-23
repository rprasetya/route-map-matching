<?php

declare(strict_types=1);

namespace RouteMapMatching;

final class CandidateFinder
{
    private array $seen;
    private int $epoch = 0;

    public function __construct(private readonly Network $net)
    {
        $this->seen = $net->edgeCount ? array_fill(0, $net->edgeCount, 0) : [];
    }

    public function find(float $lng, float $lat, float $cos, ?array $heading, float $radius, bool $leftHand = false, bool $confident = false): array
    {
        $net = $this->net;
        $epoch = ++$this->epoch;
        $seen = &$this->seen;
        $reach = (int) ceil($radius / (Config::CELL * Config::METERS_PER_DEGREE));
        $gx = (int) floor($lng / Config::CELL);
        $gy = (int) floor($lat / Config::CELL);
        $hx = $heading[0] ?? 0.0;
        $hy = $heading[1] ?? 0.0;
        $hasHeading = $heading !== null;
        $cells = $net->cells;
        $edgeA = $net->edgeA;
        $edgeB = $net->edgeB;
        $nodeLng = $net->nodeLng;
        $nodeLat = $net->nodeLat;
        $list = [];
        $scores = [];
        for ($x = $gx - $reach; $x <= $gx + $reach; $x++) {
            for ($y = $gy - $reach; $y <= $gy + $reach; $y++) {
                $edges = $cells[($x + 16777216) * 33554432 + ($y + 16777216)] ?? null;
                if ($edges === null) {
                    continue;
                }
                foreach ($edges as $e) {
                    if ($seen[$e] === $epoch) {
                        continue;
                    }
                    $seen[$e] = $epoch;
                    $a = $edgeA[$e];
                    $b = $edgeB[$e];
                    $aLng = $nodeLng[$a];
                    $aLat = $nodeLat[$a];
                    $bLng = $nodeLng[$b];
                    $bLat = $nodeLat[$b];
                    $ax = $aLng * $cos;
                    $dx = $bLng * $cos - $ax;
                    $dy = $bLat - $aLat;
                    $pj = $dx * $dx + $dy * $dy;
                    $t = $pj > 0 ? max(0.0, min(1.0, (($lng * $cos - $ax) * $dx + ($lat - $aLat) * $dy) / $pj)) : 0.0;
                    $pLng = $aLng + ($bLng - $aLng) * $t;
                    $pLat = $aLat + ($bLat - $aLat) * $t;
                    $c2 = cos((($lat + $pLat) / 2) * Config::RAD);
                    $ex = ($pLng - $lng) * $c2 * Config::METERS_PER_DEGREE;
                    $ey = ($pLat - $lat) * Config::METERS_PER_DEGREE;
                    $d = sqrt($ex * $ex + $ey * $ey);
                    if ($d > $radius) {
                        continue;
                    }
                    $aligned = $hasHeading && $net->edgeHasDir[$e];
                    $along = $aligned ? $hx * $net->edgeDirX[$e] + $hy * $net->edgeDirY[$e] : 0.0;
                    $parallel = $aligned ? abs($along) : 1.0;
                    if ($parallel < Config::PARALLEL_MIN && $d > Config::NEAR_M) {
                        continue;
                    }
                    $score = $d + Config::HEADING_PENALTY_M * (1 - $parallel) + $net->edgePenalty[$e];
                    if ($confident && $hasHeading && $parallel >= Config::PARALLEL_MIN) {
                        if ($net->edgeOneway[$e] * $along < 0) {
                            $score += Config::WRONG_WAY_PENALTY_M;
                        }
                        if ($leftHand) {
                            $score -= Config::LEFT_BIAS * ($hx * ($pLat - $lat) * Config::METERS_PER_DEGREE - $hy * ($pLng - $lng) * $cos * Config::METERS_PER_DEGREE);
                        }
                    }
                    $list[] = new Candidate($e, $t, $pLng, $pLat, $score);
                    $scores[] = $score;
                }
            }
        }
        $count = count($list);
        if ($count > 1) {
            $order = range(0, $count - 1);
            usort($order, static fn (int $p, int $q): int => $scores[$p] <=> $scores[$q]);
            $sorted = [];
            $limit = min($count, Config::MAX_CANDIDATES);
            for ($i = 0; $i < $limit; $i++) {
                $sorted[] = $list[$order[$i]];
            }

            return $sorted;
        }

        return $list;
    }
}
