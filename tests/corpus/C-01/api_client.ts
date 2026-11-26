import type { AnalyticsSummary, ApiEnvelope, OrderFilter, OrderRecord } from './types';
import { buildEmptySummary, computeNetCents } from './types';

export interface HttpTransport {
  get(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }>;
  post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }>;
}

/**
 * Fetches filtered orders from the analytics backend.
 */
export async function fetchOrders(
  transport: HttpTransport,
  baseUrl: string,
  token: string,
  filter: OrderFilter,
): Promise<ApiEnvelope<OrderRecord[]>> {
  if (!token.trim()) {
    return { ok: false, status: 401, data: null, error: 'Missing bearer token' };
  }
  if (filter.limit <= 0 || filter.limit > 500) {
    return { ok: false, status: 400, data: null, error: 'Limit out of bounds' };
  }
  const query = `merchant=${encodeURIComponent(filter.merchantId)}&limit=${filter.limit}`;
  const resp = await transport.get(`${baseUrl}/v1/orders?${query}`, {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
  });
  if (resp.status < 200 || resp.status >= 300) {
    return { ok: false, status: resp.status, data: null, error: `Upstream HTTP ${resp.status}` };
  }
  const parsed = JSON.parse(resp.body) as OrderRecord[];
  return { ok: true, status: resp.status, data: parsed, error: null };
}

/**
 * Fetches aggregate summary metrics for a merchant dashboard.
 */
export async function fetchSummary(
  transport: HttpTransport,
  baseUrl: string,
  token: string,
  merchantId: string,
): Promise<ApiEnvelope<AnalyticsSummary>> {
  if (!token.trim()) {
    return { ok: false, status: 401, data: null, error: 'Missing bearer token' };
  }
  if (!merchantId.trim()) {
    return { ok: false, status: 400, data: null, error: 'Merchant ID is required' };
  }
  const resp = await transport.get(`${baseUrl}/v1/summary/${encodeURIComponent(merchantId)}`, {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
  });
  if (resp.status < 200 || resp.status >= 300) {
    return { ok: false, status: resp.status, data: null, error: `Upstream HTTP ${resp.status}` };
  }
  const parsed = JSON.parse(resp.body) as AnalyticsSummary;
  return { ok: true, status: resp.status, data: parsed, error: null };
}

/**
 * Submits a manual flag review decision for a single order.
 */
export async function flagOrderForReview(
  transport: HttpTransport,
  baseUrl: string,
  token: string,
  orderId: string,
  reason: string,
): Promise<ApiEnvelope<OrderRecord>> {
  if (!token.trim()) {
    return { ok: false, status: 401, data: null, error: 'Missing bearer token' };
  }
  if (!orderId.trim() || !reason.trim()) {
    return { ok: false, status: 400, data: null, error: 'Order ID and reason are required' };
  }
  const payload = JSON.stringify({ orderId, reason });
  const resp = await transport.post(`${baseUrl}/v1/orders/${encodeURIComponent(orderId)}/flag`, payload, {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  });
  if (resp.status < 200 || resp.status >= 300) {
    return { ok: false, status: resp.status, data: null, error: `Upstream HTTP ${resp.status}` };
  }
  const parsed = JSON.parse(resp.body) as OrderRecord;
  return { ok: true, status: resp.status, data: parsed, error: null };
}

export function summarizeOrders(orders: OrderRecord[]): AnalyticsSummary {
  if (orders.length === 0) {
    return buildEmptySummary();
  }
  let settledVolumeCents = 0;
  let flaggedCount = 0;
  let totalNet = 0;
  for (const order of orders) {
    totalNet += computeNetCents(order);
    if (order.status === 'settled') {
      settledVolumeCents += order.amountCents;
    } else if (order.status === 'flagged') {
      flaggedCount += 1;
    }
  }
  return {
    totalCount: orders.length,
    settledVolumeCents,
    flaggedCount,
    averageTicketCents: Math.round(totalNet / orders.length),
  };
}
