<?php

declare(strict_types=1);

final class LedgerCalculator
{
    public function add(int $left, int $right): int
    {
        return $left + $right;
    }

    public function clamp(int $value, int $min, int $max): int
    {
        return max($min, min($max, $value));
    }
}
