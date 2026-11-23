<?php

declare(strict_types=1);

namespace RouteMapMatching\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RouteMapMatching\LeftHandTraffic;
use RouteMapMatching\Matcher;
use RouteMapMatching\Network;

final class FixtureTest extends TestCase
{
    private const TOLERANCE = 1e-9;

    public static function fixtures(): iterable
    {
        $files = glob(__DIR__ . '/../../tests/fixtures/*.json');
        sort($files);
        foreach ($files as $file) {
            $fixture = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
            yield $fixture['name'] => [$fixture];
        }
    }

    #[DataProvider('fixtures')]
    public function testMatchesSharedFixture(array $fixture): void
    {
        $network = Network::build($fixture['roads']);
        $result = Matcher::matchPoints($fixture['points'], $network, [
            'include' => $fixture['include'],
            'leftHandTraffic' => $fixture['leftHandTraffic'] ?? false,
        ]);
        $this->assertCount(count($fixture['expected']), $result);
        $problems = [];
        foreach ($fixture['expected'] as $i => $want) {
            $got = $result[$i];
            if ($got['index'] !== $want['index']) {
                $problems[] = "#{$i} index";
            }
            if ($got['skipped'] !== $want['skipped']) {
                $problems[] = "#{$i} skipped " . var_export($got['skipped'], true);
                continue;
            }
            if ($want['skipped']) {
                continue;
            }
            if (abs($got['position'][0] - $want['position'][0]) > self::TOLERANCE || abs($got['position'][1] - $want['position'][1]) > self::TOLERANCE) {
                $problems[] = "#{$i} position";
            }
            if (count($got['path']) !== count($want['path'])) {
                $problems[] = "#{$i} path length " . count($got['path']) . ' != ' . count($want['path']);
                continue;
            }
            foreach ($want['path'] as $k => $q) {
                if (abs($got['path'][$k][0] - $q[0]) > self::TOLERANCE || abs($got['path'][$k][1] - $q[1]) > self::TOLERANCE) {
                    $problems[] = "#{$i} path[{$k}]";
                }
            }
        }
        $this->assertSame([], $problems);
    }

    public function testMatchCoordinatesEqualsToCoordinates(): void
    {
        $fixture = json_decode((string) file_get_contents(__DIR__ . '/../../tests/fixtures/grid-turns.json'), true);
        $network = Network::build($fixture['roads']);
        $this->assertSame(
            Matcher::toCoordinates(Matcher::matchPoints($fixture['points'], $network)),
            Matcher::matchCoordinates($fixture['points'], $network),
        );
    }

    public function testAutoTrafficSideMatchesExplicitFlags(): void
    {
        $fixture = json_decode((string) file_get_contents(__DIR__ . '/../../tests/fixtures/divided-oneway-left-hand.json'), true);
        $network = Network::build($fixture['roads']);
        $this->assertSame(
            Matcher::matchPoints($fixture['points'], $network, ['leftHandTraffic' => true]),
            Matcher::matchPoints($fixture['points'], $network),
        );
    }

    public function testSnapToRoad(): void
    {
        $network = Network::build([[[106.8, -6.2], [106.81, -6.2]]]);
        $snapped = Matcher::snapToRoad($network, [106.805, -6.2002]);
        $this->assertNotNull($snapped);
        $this->assertEqualsWithDelta(-6.2, $snapped[1], 1e-9);
        $this->assertNull(Matcher::snapToRoad($network, [106.805, -6.3]));
    }

    public function testLeftHandTraffic(): void
    {
        $this->assertTrue(LeftHandTraffic::contains(106.8456, -6.2088));
        $this->assertTrue(LeftHandTraffic::contains(-0.1276, 51.5072));
        $this->assertTrue(LeftHandTraffic::contains(139.69, 35.69));
        $this->assertTrue(LeftHandTraffic::contains(114.17, 22.32));
        $this->assertTrue(LeftHandTraffic::contains(119.41, -5.13));
        $this->assertFalse(LeftHandTraffic::contains(114.05, 22.62));
        $this->assertFalse(LeftHandTraffic::contains(120.98, 14.6));
        $this->assertFalse(LeftHandTraffic::contains(2.3522, 48.8566));
        $this->assertFalse(LeftHandTraffic::contains(-74.006, 40.7128));
    }
}
