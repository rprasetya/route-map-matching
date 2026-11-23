<?php

declare(strict_types=1);

namespace RouteMapMatching;

final class Search
{
    private array $cost;
    private array $parent;
    private array $parentArc;
    private array $reached;
    private array $settled;
    private array $wanted;
    private int $epoch = 0;
    private ?Candidate $source = null;
    private bool $weighted = false;
    public float $routeLength = INF;
    public int $routeNode = -1;

    public function __construct(private readonly Network $net)
    {
        $n = $net->nodeCount;
        $this->cost = $n ? array_fill(0, $n, 0.0) : [];
        $this->parent = $n ? array_fill(0, $n, -1) : [];
        $this->parentArc = $n ? array_fill(0, $n, -1) : [];
        $this->reached = $n ? array_fill(0, $n, 0) : [];
        $this->settled = $n ? array_fill(0, $n, 0) : [];
        $this->wanted = $n ? array_fill(0, $n, 0) : [];
    }

    public function run(Candidate $from, float $limit, bool $weighted, ?array $targets): void
    {
        $net = $this->net;
        $epoch = ++$this->epoch;
        $this->source = $from;
        $this->weighted = $weighted;
        $cost = &$this->cost;
        $parent = &$this->parent;
        $parentArc = &$this->parentArc;
        $reached = &$this->reached;
        $settled = &$this->settled;
        $wanted = &$this->wanted;
        $edgeA = $net->edgeA;
        $edgeB = $net->edgeB;
        $remaining = -1;
        if ($targets !== null) {
            $remaining = 0;
            foreach ($targets as $t) {
                $node = $edgeA[$t->edge];
                if ($wanted[$node] !== $epoch) {
                    $wanted[$node] = $epoch;
                    $remaining++;
                }
                $node = $edgeB[$t->edge];
                if ($wanted[$node] !== $epoch) {
                    $wanted[$node] = $epoch;
                    $remaining++;
                }
            }
        }
        $e = $from->edge;
        $f = $weighted ? $net->edgeFactor[$e] : 1.0;
        $length = $net->edgeLength[$e];
        $a = $edgeA[$e];
        $b = $edgeB[$e];
        $ca = $from->t * $length * $f * $net->edgeBackward[$e];
        $cb = (1 - $from->t) * $length * $f * $net->edgeForward[$e];
        $reached[$a] = $epoch;
        $cost[$a] = $ca;
        $parent[$a] = -1;
        $parentArc[$a] = -1;
        $hc = [$ca];
        $hn = [$a];
        $size = 1;
        if ($reached[$b] !== $epoch || $cb < $cost[$b]) {
            $reached[$b] = $epoch;
            $cost[$b] = $cb;
            $parent[$b] = -1;
            $parentArc[$b] = -1;
            if ($ca <= $cb) {
                $hc[1] = $cb;
                $hn[1] = $b;
            } else {
                $hc = [$cb, $ca];
                $hn = [$b, $a];
            }
            $size = 2;
        }
        $arcStart = $net->arcStart;
        $arcNode = $net->arcNode;
        $arcCost = $weighted ? $net->arcWeight : $net->arcDistance;
        while ($size > 0) {
            $n = $hn[0];
            $c = $hc[0];
            $last = --$size;
            if ($last > 0) {
                $mc = $hc[$last];
                $mn = $hn[$last];
                $i = 0;
                while (true) {
                    $l = $i * 2 + 1;
                    $m = $i;
                    $vm = $mc;
                    if ($l < $last && $hc[$l] < $vm) {
                        $m = $l;
                        $vm = $hc[$l];
                    }
                    $r = $l + 1;
                    if ($r < $last && $hc[$r] < $vm) {
                        $m = $r;
                        $vm = $hc[$r];
                    }
                    if ($m === $i) {
                        break;
                    }
                    $hc[$i] = $vm;
                    $hn[$i] = $hn[$m];
                    $i = $m;
                }
                $hc[$i] = $mc;
                $hn[$i] = $mn;
            }
            if ($settled[$n] === $epoch) {
                continue;
            }
            $settled[$n] = $epoch;
            if ($remaining >= 0) {
                if ($wanted[$n] === $epoch) {
                    $wanted[$n] = 0;
                    $remaining--;
                }
                if ($remaining === 0) {
                    break;
                }
            }
            $end = $arcStart[$n + 1];
            for ($i = $arcStart[$n]; $i < $end; $i++) {
                $k = $arcNode[$i];
                $nc = $c + $arcCost[$i];
                if ($nc <= $limit && ($reached[$k] !== $epoch || $nc < $cost[$k])) {
                    $reached[$k] = $epoch;
                    $cost[$k] = $nc;
                    $parent[$k] = $n;
                    $parentArc[$k] = $i;
                    $j = $size++;
                    while ($j > 0) {
                        $up = ($j - 1) >> 1;
                        $pc = $hc[$up];
                        if ($pc <= $nc) {
                            break;
                        }
                        $hc[$j] = $pc;
                        $hn[$j] = $hn[$up];
                        $j = $up;
                    }
                    $hc[$j] = $nc;
                    $hn[$j] = $k;
                }
            }
        }
    }

    public function costTo(int $node): float
    {
        return $this->reached[$node] === $this->epoch ? $this->cost[$node] : INF;
    }

    public function routeTo(Candidate $to): float
    {
        $net = $this->net;
        $from = $this->source;
        $e = $to->edge;
        $f = $this->weighted ? $net->edgeFactor[$e] : 1.0;
        $forward = $f * $net->edgeForward[$e];
        $backward = $f * $net->edgeBackward[$e];
        $length = $net->edgeLength[$e];
        $best = INF;
        $node = -1;
        if ($from->edge === $e) {
            $best = abs($to->t - $from->t) * $length * ($to->t >= $from->t ? $forward : $backward);
        }
        $a = $net->edgeA[$e];
        $ca = $this->costTo($a) + $to->t * $length * $forward;
        if ($ca < $best) {
            $best = $ca;
            $node = $a;
        }
        $b = $net->edgeB[$e];
        $cb = $this->costTo($b) + (1 - $to->t) * $length * $backward;
        if ($cb < $best) {
            $best = $cb;
            $node = $b;
        }
        $this->routeNode = $node;

        return $this->routeLength = $best;
    }

    public function wrongWay(Candidate $to, int $node): bool
    {
        $net = $this->net;
        $from = $this->source;
        if ($node < 0) {
            return $from->edge === $to->edge && ($to->t >= $from->t ? $net->edgeForward[$from->edge] : $net->edgeBackward[$from->edge]) > 1;
        }
        if (($node === $net->edgeA[$to->edge] ? $net->edgeForward[$to->edge] : $net->edgeBackward[$to->edge]) > 1) {
            return true;
        }
        $s = $node;
        for ($p = $this->parent[$s]; $p >= 0; $s = $p, $p = $this->parent[$s]) {
            if ($net->arcDistance[$this->parentArc[$s]] > Geo::distance($net->nodeLng[$p], $net->nodeLat[$p], $net->nodeLng[$s], $net->nodeLat[$s]) * 1.5) {
                return true;
            }
        }

        return ($s === $net->edgeA[$from->edge] ? $net->edgeBackward[$from->edge] : $net->edgeForward[$from->edge]) > 1;
    }

    public function path(int $node): array
    {
        $net = $this->net;
        $out = [];
        for ($s = $node; $s >= 0; $s = $this->parent[$s]) {
            $out[] = [$net->nodeLng[$s], $net->nodeLat[$s]];
        }

        return array_reverse($out);
    }

    public function pathNodes(int $node): array
    {
        $out = [];
        for ($s = $node; $s >= 0; $s = $this->parent[$s]) {
            $out[] = $s;
        }

        return array_reverse($out);
    }
}
