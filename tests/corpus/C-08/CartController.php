<?php

declare(strict_types=1);

namespace Aice\Storefront;

final class CartLine
{
    public function __construct(
        public readonly string $sku,
        public readonly int $unitCents,
        public readonly int $quantity,
    ) {
    }
}

final class CartController
{
    /**
     * Calculates subtotal, discount, tax, and final grand total in cents.
     *
     * @param CartLine[] $lines
     * @return array<string, int>
     */
    public function calculateTotal(array $lines, int $discountBps, int $taxBps): array
    {
        if ($discountBps < 0 || $discountBps > 5000) {
            throw new \InvalidArgumentException('Discount basis points out of range');
        }
        if ($taxBps < 0 || $taxBps > 3000) {
            throw new \InvalidArgumentException('Tax basis points out of range');
        }

        $subtotal = 0;
        foreach ($lines as $line) {
            if ($line->unitCents < 0 || $line->quantity <= 0) {
                throw new \InvalidArgumentException('Invalid cart line item: ' . $line->sku);
            }
            $subtotal += $line->unitCents * $line->quantity;
        }

        $discount = intdiv($subtotal * $discountBps + 5000, 10000);
        $taxable = max(0, $subtotal - $discount);
        $tax = intdiv($taxable * $taxBps + 5000, 10000);
        $total = $taxable + $tax;

        return [
            'subtotalCents' => $subtotal,
            'discountCents' => $discount,
            'taxCents' => $tax,
            'totalCents' => $total,
        ];
    }

    public function buildInvoiceNumber(string $merchantCode, int $sequence): string
    {
        if ($merchantCode === '' || $sequence <= 0) {
            throw new \InvalidArgumentException('Merchant code and sequence must be valid');
        }
        return sprintf('INV-%s-%06d', strtoupper($merchantCode), $sequence);
    }

    /**
     * Applies a flat promotional credit capped at the current total.
     */
    public function applyPromoCredit(array $totals, int $creditCents): array
    {
        if ($creditCents < 0) {
            throw new \InvalidArgumentException('Promo credit must be non-negative');
        }
        $currentTotal = $totals['totalCents'] ?? 0;
        $applied = min($currentTotal, $creditCents);
        $totals['promoCreditCents'] = $applied;
        $totals['totalCents'] = max(0, $currentTotal - $applied);
        return $totals;
    }

    /**
     * Validates that every cart line references an active catalog SKU.
     *
     * @param CartLine[] $lines
     * @param array<string, bool> $activeSkus
     * @return string[]
     */
    public function findUnavailableSkus(array $lines, array $activeSkus): array
    {
        $missing = [];
        foreach ($lines as $line) {
            if (!($activeSkus[$line->sku] ?? false)) {
                $missing[] = $line->sku;
            }
        }
        return $missing;
    }
}
