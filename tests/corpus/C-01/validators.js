const SUPPORTED_CURRENCIES = new Set(['USD', 'EUR', 'GBP']);

/**
 * Formats integer cents into a fixed two-decimal currency string.
 */
export function formatCurrencyCents(amountCents, currency) {
  if (!Number.isFinite(amountCents) || amountCents < 0) {
    throw new RangeError('amountCents must be a non-negative finite integer');
  }
  const code = SUPPORTED_CURRENCIES.has(currency) ? currency : 'USD';
  const whole = Math.floor(amountCents / 100);
  const frac = String(amountCents % 100).padStart(2, '0');
  return `${code} ${whole}.${frac}`;
}

/**
 * Validates an incoming order record before dashboard aggregation.
 */
export function validateOrder(order) {
  const errors = [];
  if (!order || typeof order !== 'object') {
    return ['Order payload must be an object'];
  }
  if (typeof order.id !== 'string' || order.id.trim().length === 0) {
    errors.push('Missing order id');
  }
  if (typeof order.merchantId !== 'string' || order.merchantId.trim().length === 0) {
    errors.push('Missing merchantId');
  }
  if (!Number.isInteger(order.amountCents) || order.amountCents <= 0) {
    errors.push('amountCents must be positive');
  }
  if (!Number.isInteger(order.feeCents) || order.feeCents < 0) {
    errors.push('feeCents must be non-negative');
  }
  if (!SUPPORTED_CURRENCIES.has(order.currency)) {
    errors.push('Unsupported currency');
  }
  return errors;
}

export function clampLimit(rawLimit, maxAllowed = 250) {
  if (!Number.isFinite(rawLimit)) {
    return 25;
  }
  const truncated = Math.trunc(rawLimit);
  if (truncated < 1) {
    return 1;
  }
  if (truncated > maxAllowed) {
    return maxAllowed;
  }
  return truncated;
}
