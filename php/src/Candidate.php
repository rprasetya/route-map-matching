<?php

declare(strict_types=1);

namespace RouteMapMatching;

final class Candidate
{
    public array $at;

    public function __construct(
        public readonly int $edge,
        public readonly float $t,
        public readonly float $lng,
        public readonly float $lat,
        public readonly float $score,
    ) {
        $this->at = [$lng, $lat];
    }
}
