<?php

declare(strict_types=1);

namespace RouteMapMatching;

final class State
{
    public function __construct(
        public Candidate $m,
        public float $cost,
        public int $from,
        public int $prev,
        public int $node,
        public ?array $route,
    ) {
    }
}
