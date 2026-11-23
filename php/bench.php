<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use RouteMapMatching\Matcher;
use RouteMapMatching\Network;

$file = $argv[1] ?? null;
if ($file === null) {
    fwrite(STDERR, "usage: php php/bench.php <scenario.json> [runs]\n");
    exit(1);
}
$runs = (int) ($argv[2] ?? 5);
$scenario = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
$builds = [];
$matches = [];
$network = null;
for ($r = 0; $r < $runs; $r++) {
    $t = hrtime(true);
    $network = Network::build($scenario['roads']);
    $builds[] = (hrtime(true) - $t) / 1e6;
    $t = hrtime(true);
    Matcher::matchPoints($scenario['points'], $network);
    $matches[] = (hrtime(true) - $t) / 1e6;
}
sort($builds);
sort($matches);
$build = $builds[intdiv($runs, 2)];
$match = $matches[intdiv($runs, 2)];
$points = count($scenario['points']);
printf(
    "%6d points  %d edges  build %8.1f ms  match %8.1f ms  %d points/s  (PHP %s, JIT %s)\n",
    $points,
    $network->edgeCount,
    $build,
    $match,
    (int) ($points / $match * 1000),
    PHP_VERSION,
    function_exists('opcache_get_status') && (opcache_get_status(false)['jit']['on'] ?? false) ? 'on' : 'off',
);
