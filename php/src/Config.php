<?php

declare(strict_types=1);

namespace RouteMapMatching;

final class Config
{
    public const METERS_PER_DEGREE = 111320.0;
    public const RAD = M_PI / 180;
    public const CELL = 0.0005;
    public const NODE_CELL = 2e-5;
    public const MERGE_M = 1.5;
    public const JOIN_M = 3.0;
    public const RADIUS_M = 50.0;
    public const WIDE_RADII_M = [100.0, 200.0];
    public const HEADING_PENALTY_M = 15.0;
    public const DETOUR_FACTOR = 3.0;
    public const DETOUR_EXTRA_M = 80.0;
    public const MAX_CANDIDATES = 6;
    public const SIGMA_M = 8.0;
    public const BETA_M = 6.0;
    public const BREAK_M = 1500.0;
    public const MAX_SKIPPED = 3;
    public const JITTER_M = 8.0;
    public const PARALLEL_MIN = 0.85;
    public const NEAR_M = 12.0;
    public const MIN_CHAIN = 3;
    public const GAP_MIN_M = 30.0;
    public const GAP_MAX_M = 5000.0;
    public const GAP_FACTOR = 2.0;
    public const GAP_EXTRA_M = 150.0;
    public const GAP_SNAPPED_FACTOR = 3.0;
    public const GAP_SNAPPED_EXTRA_M = 300.0;
    public const WEIGHT_FACTOR_MAX = 3.0;
    public const BAD_M = 20.0;
    public const UNMATCHED_ERROR_M = 80.0;
    public const LOOKAHEAD_M = 600.0;
    public const STRAIGHTEN_MAX_M = 1200.0;
    public const STRAIGHTEN_WEIGHT_MAX = 2500.0;
    public const STRAIGHTEN_SAVING = 1.08;
    public const STRAIGHTEN_SAVING_M = 15.0;
    public const TOLERANCE_MIN_M = 25.0;
    public const TOLERANCE_MAX_M = 120.0;
    public const TOLERANCE_FACTOR = 2.5;
    public const REVERSAL_M = 400.0;
    public const HOOK_M = 12.0;
    public const HOOK_NODES = 8;
    public const WRONG_WAY_PENALTY_M = 40.0;
    public const WRONG_WAY_FACTOR = 3.0;
    public const LEFT_BIAS = 0.3;
    public const HEADING_MIN_M = 3.0;
    public const HEADING_CONFIDENT_M = 15.0;
}
