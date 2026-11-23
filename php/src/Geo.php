<?php

declare(strict_types=1);

namespace RouteMapMatching;

final class Geo
{
    public static float $t = 0.0;
    public static float $lng = 0.0;
    public static float $lat = 0.0;
    public static float $d = 0.0;

    public static function distance(float $aLng, float $aLat, float $bLng, float $bLat): float
    {
        $cos = cos((($aLat + $bLat) / 2) * Config::RAD);
        $dx = ($bLng - $aLng) * $cos * Config::METERS_PER_DEGREE;
        $dy = ($bLat - $aLat) * Config::METERS_PER_DEGREE;

        return sqrt($dx * $dx + $dy * $dy);
    }

    public static function project(float $pLng, float $pLat, float $cosP, float $aLng, float $aLat, float $bLng, float $bLat): float
    {
        $ax = $aLng * $cosP;
        $dx = $bLng * $cosP - $ax;
        $dy = $bLat - $aLat;
        $pj = $dx * $dx + $dy * $dy;
        $t = $pj > 0 ? max(0.0, min(1.0, (($pLng * $cosP - $ax) * $dx + ($pLat - $aLat) * $dy) / $pj)) : 0.0;
        $lng = $aLng + ($bLng - $aLng) * $t;
        $lat = $aLat + ($bLat - $aLat) * $t;
        self::$t = $t;
        self::$lng = $lng;
        self::$lat = $lat;
        $cos = cos((($pLat + $lat) / 2) * Config::RAD);
        $ex = ($lng - $pLng) * $cos * Config::METERS_PER_DEGREE;
        $ey = ($lat - $pLat) * Config::METERS_PER_DEGREE;

        return self::$d = sqrt($ex * $ex + $ey * $ey);
    }

    public static function reverses(array $a, array $b, array $c): bool
    {
        $cos = cos($b[1] * Config::RAD);
        $ux = ($b[0] - $a[0]) * $cos;
        $uy = $b[1] - $a[1];
        $vx = ($c[0] - $b[0]) * $cos;
        $vy = $c[1] - $b[1];
        $n = sqrt($ux * $ux + $uy * $uy) * sqrt($vx * $vx + $vy * $vy);

        return $n > 0 && ($ux * $vx + $uy * $vy) / $n < -0.7;
    }

    public static function lineLength(array $line): float
    {
        $total = 0.0;
        $count = count($line);
        for ($i = 1; $i < $count; $i++) {
            $total += self::distance($line[$i - 1][0], $line[$i - 1][1], $line[$i][0], $line[$i][1]);
        }

        return $total;
    }

    public static function lengthThrough(array $start, array $path, array $end): float
    {
        $total = 0.0;
        $prev = $start;
        foreach ($path as $q) {
            $total += self::distance($prev[0], $prev[1], $q[0], $q[1]);
            $prev = $q;
        }

        return $total + self::distance($prev[0], $prev[1], $end[0], $end[1]);
    }
}
