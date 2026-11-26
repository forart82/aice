export type OrderStatus = 'pending' | 'settled' | 'flagged' | 'refunded';

export type CurrencyCode = 'USD' | 'EUR' | 'GBP';

export interface OrderRecord {
  id: string;
  merchantId: string;
  amountCents: number;
  feeCents: number;
  currency: CurrencyCode;
  status: OrderStatus;
  createdAt: string;
}

export interface OrderFilter {
  merchantId: string;
  status?: OrderStatus;
  minAmountCents?: number;
  maxAmountCents?: number;
  limit: number;
}

export interface AnalyticsSummary {
  totalCount: number;
  settledVolumeCents: number;
  flaggedCount: number;
  averageTicketCents: number;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

export function buildEmptySummary(): AnalyticsSummary {
  return {
    totalCount: 0,
    settledVolumeCents: 0,
    flaggedCount: 0,
    averageTicketCents: 0,
  };
}

export function computeNetCents(order: OrderRecord): number {
  if (order.amountCents <= order.feeCents) {
    return 0;
  }
  return order.amountCents - order.feeCents;
}
