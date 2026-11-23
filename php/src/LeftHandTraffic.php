<?php

declare(strict_types=1);

namespace RouteMapMatching;

final class LeftHandTraffic
{
    private static ?array $regions = null;

    private static function regions(): array
    {
        if (self::$regions !== null) {
            return self::$regions;
        }
        $data = trim((string) file_get_contents(__DIR__ . '/../../data/left-hand-traffic.txt'));
        $regions = [];
        foreach (explode(',', $data) as $polygon) {
            $minLng = INF;
            $minLat = INF;
            $maxLng = -INF;
            $maxLat = -INF;
            $rings = [];
            foreach (explode(' ', $polygon) as $s) {
                $ring = [];
                $i = 0;
                $x = 0;
                $y = 0;
                $len = strlen($s);
                while ($i < $len) {
                    $delta = [];
                    for ($k = 0; $k < 2; $k++) {
                        $shift = 0;
                        $value = 0;
                        do {
                            if ($i >= $len) {
                                $i++;
                                break;
                            }
                            $b = ord($s[$i++]) - 63;
                            $value |= ($b & 0x1f) << $shift;
                            $shift += 5;
                        } while ($b >= 0x20);
                        $delta[$k] = ($value & 1) ? ~($value >> 1) : ($value >> 1);
                    }
                    $x += $delta[0];
                    $y += $delta[1];
                    $lng = $x / 1000;
                    $lat = $y / 1000;
                    $ring[] = $lng;
                    $ring[] = $lat;
                    $minLng = min($minLng, $lng);
                    $minLat = min($minLat, $lat);
                    $maxLng = max($maxLng, $lng);
                    $maxLat = max($maxLat, $lat);
                }
                $rings[] = $ring;
            }
            $regions[] = [$minLng, $minLat, $maxLng, $maxLat, $rings];
        }

        return self::$regions = $regions;
    }

    public static function contains(float $lng, float $lat): bool
    {
        foreach (self::regions() as [$minLng, $minLat, $maxLng, $maxLat, $rings]) {
            if ($lng < $minLng || $lng > $maxLng || $lat < $minLat || $lat > $maxLat) {
                continue;
            }
            $inside = false;
            foreach ($rings as $t) {
                $count = count($t);
                for ($i = 0, $j = $count - 2; $i < $count; $j = $i, $i += 2) {
                    if (($t[$i + 1] > $lat) !== ($t[$j + 1] > $lat) && $lng < (($t[$j] - $t[$i]) * ($lat - $t[$i + 1])) / ($t[$j + 1] - $t[$i + 1]) + $t[$i]) {
                        $inside = !$inside;
                    }
                }
            }
            if ($inside) {
                return true;
            }
        }

        return false;
    }

    public static function polygons(): array
    {
        $out = [];
        foreach (self::regions() as [, , , , $rings]) {
            $polygon = [];
            foreach ($rings as $ring) {
                $points = [];
                $count = count($ring);
                for ($i = 0; $i < $count; $i += 2) {
                    $points[] = [$ring[$i], $ring[$i + 1]];
                }
                $polygon[] = $points;
            }
            $out[] = $polygon;
        }

        return $out;
    }

    public static function flags(array $coordinates): array
    {
        $out = [];
        foreach ($coordinates as $c) {
            $out[] = self::contains((float) $c[0], (float) $c[1]);
        }

        return $out;
    }
}
