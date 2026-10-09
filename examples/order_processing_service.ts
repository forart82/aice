import { Address, Money, TaxRate, DiscountCode, ProductVariant, InventoryItem, CustomerProfile, CartItem, ShoppingCart, ShippingRate, PaymentDetails, FraudScore, AuditEntry, InvoiceItem, InvoiceSummary, WarehouseLocation, CarrierConfig, createMoney, formatCurrency, addMoney, subtractMoney, multiplyMoney, calculateSalesTax, validateSku, calculateDiscount, evaluateCustomerTier, calculateLoyaltyPoints, isStockAvailable, reserveStock, releaseStock, commitStock, checkReorderNeeded, calculateItemTotal, calculateCartSubtotalCents, calculateCartWeightGrams, calculateShippingCost, validateOrderTransition, calculateRiskScore, generateInvoiceNumber, calculateLineItemTotal, buildInvoiceSummary, formatAuditEntry, isWarehouseOverCapacity, calculateWarehouseLoadPercent, generateTrackingUrl, createCustomer, updateCustomerSpend, suspendCustomer, reinstateCustomer, sanitizeAddress, isDomesticShipment, estimateDeliveryDate, createProductVariant, createDigitalProductVariant, computeBulkDiscount, calculateFinalCartItemPrice, isEligibleForFreeShipping, applyTaxExemption, calculateCompoundedTax, formatReceiptLine, parseCurrencyCode, calculateRestockingFee, computeNetRefundCents } from "./ecommerce_domain.js";

export interface CheckoutSession {
  sessionId: string;
  cartId: string;
  customerId: string;
  shippingAddress: Address;
  billingAddress: Address;
  selectedCarrier: string;
  promoCode: string;
  createdAtTimestamp: number;
  expiresAtTimestamp: number;
  isCompleted: boolean;
}

export function CheckoutSession(sessionId: string, cartId: string, customerId: string, shippingAddress: Address, billingAddress: Address, selectedCarrier: string, promoCode: string, createdAtTimestamp: number, expiresAtTimestamp: number, isCompleted: boolean): CheckoutSession {
  return { sessionId, cartId, customerId, shippingAddress, billingAddress, selectedCarrier, promoCode, createdAtTimestamp, expiresAtTimestamp, isCompleted };
}

export interface OrderValidationResult {
  isValid: boolean;
  blockingErrors: string[];
  warningNotes: string[];
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  discountCents: number;
  finalTotalCents: number;
}

export function OrderValidationResult(isValid: boolean, blockingErrors: string[], warningNotes: string[], subtotalCents: number, taxCents: number, shippingCents: number, discountCents: number, finalTotalCents: number): OrderValidationResult {
  return { isValid, blockingErrors, warningNotes, subtotalCents, taxCents, shippingCents, discountCents, finalTotalCents };
}

export interface PaymentTransaction {
  transactionId: string;
  orderId: string;
  provider: string;
  amountCents: number;
  status: string;
  authCode: string;
  capturedAtTimestamp: number;
}

export function PaymentTransaction(transactionId: string, orderId: string, provider: string, amountCents: number, status: string, authCode: string, capturedAtTimestamp: number): PaymentTransaction {
  return { transactionId, orderId, provider, amountCents, status, authCode, capturedAtTimestamp };
}

export interface WarehouseAllocation {
  orderId: string;
  sku: string;
  allocatedWarehouseId: string;
  allocatedQuantity: number;
  routePriority: number;
}

export function WarehouseAllocation(orderId: string, sku: string, allocatedWarehouseId: string, allocatedQuantity: number, routePriority: number): WarehouseAllocation {
  return { orderId, sku, allocatedWarehouseId, allocatedQuantity, routePriority };
}

export interface FulfillmentBatch {
  batchId: string;
  warehouseId: string;
  assignedCarrier: string;
  orderIds: string[];
  totalPackages: number;
  isDispatched: boolean;
  dispatchedTimestamp: number;
}

export function FulfillmentBatch(batchId: string, warehouseId: string, assignedCarrier: string, orderIds: string[], totalPackages: number, isDispatched: boolean, dispatchedTimestamp: number): FulfillmentBatch {
  return { batchId, warehouseId, assignedCarrier, orderIds, totalPackages, isDispatched, dispatchedTimestamp };
}

export interface ShippingManifest {
  manifestId: string;
  carrierCode: string;
  trackingNumbers: string[];
  totalWeightGrams: number;
  destinationHub: string;
  generatedTimestamp: number;
}

export function ShippingManifest(manifestId: string, carrierCode: string, trackingNumbers: string[], totalWeightGrams: number, destinationHub: string, generatedTimestamp: number): ShippingManifest {
  return { manifestId, carrierCode, trackingNumbers, totalWeightGrams, destinationHub, generatedTimestamp };
}

export interface RefundRequest {
  refundId: string;
  orderId: string;
  customerId: string;
  itemSkus: string[];
  reason: string;
  requestedAmountCents: number;
  isRestockingFeeApplied: boolean;
}

export function RefundRequest(refundId: string, orderId: string, customerId: string, itemSkus: string[], reason: string, requestedAmountCents: number, isRestockingFeeApplied: boolean): RefundRequest {
  return { refundId, orderId, customerId, itemSkus, reason, requestedAmountCents, isRestockingFeeApplied };
}

export interface RefundReceipt {
  receiptId: string;
  orderId: string;
  refundedCents: number;
  restockingFeeCents: number;
  issuedTimestamp: number;
  gatewayReference: string;
}

export function RefundReceipt(receiptId: string, orderId: string, refundedCents: number, restockingFeeCents: number, issuedTimestamp: number, gatewayReference: string): RefundReceipt {
  return { receiptId, orderId, refundedCents, restockingFeeCents, issuedTimestamp, gatewayReference };
}

export interface OrderNotification {
  notificationId: string;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  channel: string;
  isSent: boolean;
}

export function OrderNotification(notificationId: string, recipientEmail: string, subject: string, bodyText: string, channel: string, isSent: boolean): OrderNotification {
  return { notificationId, recipientEmail, subject, bodyText, channel, isSent };
}

export interface DisputeRecord {
  disputeId: string;
  orderId: string;
  chargebackCents: number;
  reasonCode: string;
  evidenceDueDate: number;
  isResolved: boolean;
}

export function DisputeRecord(disputeId: string, orderId: string, chargebackCents: number, reasonCode: string, evidenceDueDate: number, isResolved: boolean): DisputeRecord {
  return { disputeId, orderId, chargebackCents, reasonCode, evidenceDueDate, isResolved };
}

export interface BatchShipmentSummary {
  batchId: string;
  successfulCount: number;
  failedCount: number;
  totalPostageCents: number;
}

export function BatchShipmentSummary(batchId: string, successfulCount: number, failedCount: number, totalPostageCents: number): BatchShipmentSummary {
  return { batchId, successfulCount, failedCount, totalPostageCents };
}

export interface DailyFulfillmentMetrics {
  dateKey: string;
  ordersReceived: number;
  ordersDispatched: number;
  ordersDelivered: number;
  averageProcessingMinutes: number;
  grossRevenueCents: number;
}

export function DailyFulfillmentMetrics(dateKey: string, ordersReceived: number, ordersDispatched: number, ordersDelivered: number, averageProcessingMinutes: number, grossRevenueCents: number): DailyFulfillmentMetrics {
  return { dateKey, ordersReceived, ordersDispatched, ordersDelivered, averageProcessingMinutes, grossRevenueCents };
}

export interface SlaEvaluationResult {
  orderId: string;
  targetDispatchTimestamp: number;
  isBreached: boolean;
  breachReason: string;
}

export function SlaEvaluationResult(orderId: string, targetDispatchTimestamp: number, isBreached: boolean, breachReason: string): SlaEvaluationResult {
  return { orderId, targetDispatchTimestamp, isBreached, breachReason };
}

export interface ReconciliationReport {
  reportId: string;
  batchId: string;
  expectedTotalCents: number;
  settledTotalCents: number;
  discrepancyCents: number;
  isBalanced: boolean;
}

export function ReconciliationReport(reportId: string, batchId: string, expectedTotalCents: number, settledTotalCents: number, discrepancyCents: number, isBalanced: boolean): ReconciliationReport {
  return { reportId, batchId, expectedTotalCents, settledTotalCents, discrepancyCents, isBalanced };
}

export function createCheckoutSession(sessId: string, cart: ShoppingCart, shipAddr: Address, billAddr: Address, now: number): CheckoutSession {
  const session = { sessionId: sessId, cartId: cart.cartId, customerId: cart.customerId, shippingAddress: shipAddr, billingAddress: billAddr, selectedCarrier: "STANDARD_GROUND", promoCode: cart.appliedDiscount, createdAtTimestamp: now, expiresAtTimestamp: (now + 3600), isCompleted: false };
  return session;
}

export function isSessionExpired(session: CheckoutSession, now: number): boolean {
  return (now > session.expiresAtTimestamp);
}

export function validateCheckoutItems(items: CartItem[]): { ok: true; value: boolean } | { ok: false; error: string } {
  if ((items.length === 0)) {
    return { ok: false, error: "Cart cannot be empty for checkout" };
  }
  for (const item of items) {
    if ((item.quantity <= 0)) {
      return { ok: false, error: "Invalid item quantity" };
    }
    if ((item.unitPriceCents < 0)) {
      return { ok: false, error: "Invalid unit price" };
    }
  }
  return { ok: true, value: true };
}

export function validateSession(session: CheckoutSession, cart: ShoppingCart, now: number): OrderValidationResult {
  let errors: string[] = [];
  let warnings: string[] = [];
  if (isSessionExpired(session, now)) {
    errors = [...errors, "Checkout session expired"];
  }
  if ((cart.items.length === 0)) {
    errors = [...errors, "Shopping cart is empty"];
  }
  const subtotal = calculateCartSubtotalCents(cart.items);
  if ((subtotal > 5000000)) {
    warnings = [...warnings, "Large order requires secondary fraud review"];
  }
  let valid = true;
  if ((errors.length > 0)) {
    valid = false;
  }
  const res = { isValid: valid, blockingErrors: errors, warningNotes: warnings, subtotalCents: subtotal, taxCents: 0, shippingCents: 0, discountCents: 0, finalTotalCents: subtotal };
  return res;
}

export function resolveBestWarehouse(sku: string, requiredQty: number, warehouses: WarehouseLocation[]): { ok: true; value: string } | { ok: false; error: string } {
  let bestWarehouse = "";
  let lowestLoad = 1000;
  for (const wh of warehouses) {
    if (!(isWarehouseOverCapacity(wh))) {
      const load = calculateWarehouseLoadPercent(wh);
      if ((load < lowestLoad)) {
        lowestLoad = load;
        bestWarehouse = wh.warehouseId;
      }
    }
  }
  if ((bestWarehouse.length === 0)) {
    return { ok: false, error: "No warehouse with available capacity found" };
  }
  return { ok: true, value: bestWarehouse };
}

export function allocateOrderInventory(orderId: string, items: CartItem[], warehouses: WarehouseLocation[]): { ok: true; value: WarehouseAllocation[] } | { ok: false; error: string } {
  let allocations: WarehouseAllocation[] = [];
  for (const item of items) {
    const whId = (resolveBestWarehouse(item.sku, item.quantity, warehouses) as any).value;
    const alloc = { orderId, sku: item.sku, allocatedWarehouseId: whId, allocatedQuantity: item.quantity, routePriority: 1 };
    allocations = [...allocations, alloc];
  }
  return { ok: true, value: allocations };
}

export function processCardPayment(txId: string, orderId: string, provider: string, amountCents: number, now: number): { ok: true; value: PaymentTransaction } | { ok: false; error: string } {
  if ((amountCents <= 0)) {
    return { ok: false, error: "Payment amount must be positive" };
  }
  const tx = { transactionId: txId, orderId, provider, amountCents, status: "CAPTURED", authCode: ("AUTH-" + txId), capturedAtTimestamp: now };
  return { ok: true, value: tx };
}

export function voidPayment(tx: PaymentTransaction): PaymentTransaction {
  const updated = { transactionId: tx.transactionId, orderId: tx.orderId, provider: tx.provider, amountCents: tx.amountCents, status: "VOIDED", authCode: tx.authCode, capturedAtTimestamp: tx.capturedAtTimestamp };
  return updated;
}

export function evaluateOrderRisk(profile: CustomerProfile, totalCents: number, isDomestic: boolean): FraudScore {
  return calculateRiskScore(profile, totalCents, !(isDomestic));
}

export function prepareFulfillmentBatch(batchId: string, whId: string, carrier: string, orders: string[], now: number): FulfillmentBatch {
  const batch = { batchId, warehouseId: whId, assignedCarrier: carrier, orderIds: orders, totalPackages: orders.length, isDispatched: false, dispatchedTimestamp: 0 };
  return batch;
}

export function dispatchFulfillmentBatch(batch: FulfillmentBatch, now: number): FulfillmentBatch {
  const updated = { batchId: batch.batchId, warehouseId: batch.warehouseId, assignedCarrier: batch.assignedCarrier, orderIds: batch.orderIds, totalPackages: batch.totalPackages, isDispatched: true, dispatchedTimestamp: now };
  return updated;
}

export function createShippingManifest(manifestId: string, carrier: string, trackingNums: string[], weightGrams: number, hub: string, now: number): ShippingManifest {
  const manifest = { manifestId, carrierCode: carrier, trackingNumbers: trackingNums, totalWeightGrams: weightGrams, destinationHub: hub, generatedTimestamp: now };
  return manifest;
}

export function processCustomerRefund(request: RefundRequest, isOpened: boolean, now: number): RefundReceipt {
  let fee = 0;
  if (request.isRestockingFeeApplied) {
    fee = calculateRestockingFee(request.requestedAmountCents, isOpened);
  }
  const netRefund = computeNetRefundCents(request.requestedAmountCents, fee);
  const receipt = { receiptId: ("REC-" + request.refundId), orderId: request.orderId, refundedCents: netRefund, restockingFeeCents: fee, issuedTimestamp: now, gatewayReference: ("GATEWAY-REF-" + request.refundId) };
  return receipt;
}

export function buildOrderConfirmationEmail(orderId: string, email: string, totalCents: number, trackingNumber: string): OrderNotification {
  const dollars = Math.floor((totalCents / 100));
  const body = ((((("Thank you for your order #" + orderId) + ". Total: $") + dollars.toString()) + ". Tracking: ") + trackingNumber);
  const notif = { notificationId: ("NOTIF-" + orderId), recipientEmail: email, subject: ("Order Confirmation - #" + orderId), bodyText: body, channel: "EMAIL", isSent: false };
  return notif;
}

export function buildShippingNotification(orderId: string, email: string, carrier: string, trackingUrl: string): OrderNotification {
  const body = ((((("Your order #" + orderId) + " has shipped via ") + carrier) + ". Track package: ") + trackingUrl);
  const notif = { notificationId: ("SHIP-NOTIF-" + orderId), recipientEmail: email, subject: ("Your Package is on the Way - #" + orderId), bodyText: body, channel: "EMAIL", isSent: false };
  return notif;
}

export function recordAuditTrail(action: string, entityType: string, entityId: string, actorId: string, now: number): AuditEntry {
  const entry = { auditId: ((("AUDIT-" + entityId) + "-") + now.toString()), action, entityType, entityId, actorId, timestamp: now };
  return entry;
}

export function logDisputeFiled(disputeId: string, orderId: string, chargebackCents: number, reason: string, dueDate: number): DisputeRecord {
  const disp = { disputeId, orderId, chargebackCents, reasonCode: reason, evidenceDueDate: dueDate, isResolved: false };
  return disp;
}

export function resolveDispute(dispute: DisputeRecord): DisputeRecord {
  const updated = { disputeId: dispute.disputeId, orderId: dispute.orderId, chargebackCents: dispute.chargebackCents, reasonCode: dispute.reasonCode, evidenceDueDate: dispute.evidenceDueDate, isResolved: true };
  return updated;
}

export function calculateDailyMetrics(dateKey: string, received: number, dispatched: number, delivered: number, revenue: number): DailyFulfillmentMetrics {
  const m = { dateKey, ordersReceived: received, ordersDispatched: dispatched, ordersDelivered: delivered, averageProcessingMinutes: 45, grossRevenueCents: revenue };
  return m;
}

export function calculateFulfillmentEfficiency(metrics: DailyFulfillmentMetrics): number {
  if ((metrics.ordersReceived === 0)) {
    return 100;
  }
  return Math.floor(((metrics.ordersDispatched * 100) / metrics.ordersReceived));
}

export function verifyCheckoutPreconditions(session: CheckoutSession, profile: CustomerProfile): { ok: true; value: boolean } | { ok: false; error: string } {
  if (profile.isSuspended) {
    return { ok: false, error: "Suspended customer cannot initiate checkout" };
  }
  if (session.isCompleted) {
    return { ok: false, error: "Checkout session already completed" };
  }
  return { ok: true, value: true };
}

export function finalizeOrderCheckout(session: CheckoutSession, profile: CustomerProfile, cart: ShoppingCart, warehouses: WarehouseLocation[], carrier: ShippingRate, now: number): { ok: true; value: InvoiceSummary } | { ok: false; error: string } {
  (verifyCheckoutPreconditions(session, profile) as any).value;
  (validateCheckoutItems(cart.items) as any).value;
  const subtotal = calculateCartSubtotalCents(cart.items);
  const weight = calculateCartWeightGrams(cart.items, 350);
  const shippingMoney = calculateShippingCost(weight, 50, carrier);
  const risk = evaluateOrderRisk(profile, subtotal, isDomesticShipment(session.shippingAddress, "USA"));
  if ((risk.riskLevel === "CRITICAL")) {
    return { ok: false, error: "Order rejected by automated risk engine" };
  }
  const allocs = (allocateOrderInventory(session.sessionId, cart.items, warehouses) as any).value;
  const payment = (processCardPayment(("TX-" + session.sessionId), session.sessionId, "STRIPE", (subtotal + shippingMoney.amountInCents), now) as any).value;
  const invNum = generateInvoiceNumber(session.sessionId, now);
  const inv = buildInvoiceSummary(invNum, session.sessionId, subtotal, 0, shippingMoney.amountInCents, now);
  return { ok: true, value: inv };
}

export function cancelOrderSession(session: CheckoutSession, reason: string, now: number): AuditEntry {
  const audit = recordAuditTrail("CANCEL_CHECKOUT", "CheckoutSession", session.sessionId, "SYSTEM", now);
  return audit;
}

export function computePackageVolumeCm3(lengthCm: number, widthCm: number, heightCm: number): number {
  return ((lengthCm * widthCm) * heightCm);
}

export function computeDimensionalWeightGrams(lengthCm: number, widthCm: number, heightCm: number, divisor: number): number {
  const vol = computePackageVolumeCm3(lengthCm, widthCm, heightCm);
  return Math.floor(((vol * 1000) / divisor));
}

export function determineBillableWeightGrams(actualWeightGrams: number, dimWeightGrams: number): number {
  if ((dimWeightGrams > actualWeightGrams)) {
    return dimWeightGrams;
  } else {
    return actualWeightGrams;
  }
}

export function formatCarrierTrackingUrl(config: CarrierConfig, trackingNum: string): string {
  return generateTrackingUrl(config.trackingUrlTemplate, trackingNum);
}

export function shouldTriggerRestock(item: InventoryItem): boolean {
  return checkReorderNeeded(item);
}

export function generateRestockOrderSummary(item: InventoryItem, targetStock: number): number {
  const currentNet = (item.availableQuantity - item.reservedQuantity);
  const needed = (targetStock - currentNet);
  if ((needed < 0)) {
    return 0;
  } else {
    return needed;
  }
}

export function computeGrossMarginBps(revenueCents: number, costCents: number): number {
  if ((revenueCents === 0)) {
    return 0;
  }
  const profit = (revenueCents - costCents);
  return Math.floor(((profit * 10000) / revenueCents));
}

export function validateCarrierAccount(config: CarrierConfig): boolean {
  if ((config.carrierCode.length === 0)) {
    return false;
  }
  if ((config.apiUrl.length === 0)) {
    return false;
  }
  if ((config.accountNumber.length === 0)) {
    return false;
  }
  return true;
}

export function calculateBatchPostageCost(manifest: ShippingManifest, costPerKgCents: number): number {
  const kg = Math.floor((manifest.totalWeightGrams / 1000));
  return (kg * costPerKgCents);
}

export function isManifestFullyDelivered(manifest: ShippingManifest, deliveredTrackingCodes: string[]): boolean {
  for (const track of manifest.trackingNumbers) {
    if (!(deliveredTrackingCodes.includes(track))) {
      return false;
    }
  }
  return true;
}

export function createDefaultShippingRate(carrierName: string, basePriceCents: number): ShippingRate {
  const rate = { carrier: carrierName, serviceLevel: "EXPEDITED", baseCostCents: basePriceCents, perKilogramCents: 250, estimatedDays: 3 };
  return rate;
}

export function calculateEstimatedFulfillmentHours(distanceKm: number, isExpress: boolean): number {
  if (isExpress) {
    return 24;
  }
  if ((distanceKm < 500)) {
    return 48;
  }
  return 72;
}

export function summarizeBatchShipment(batch: FulfillmentBatch, postageCents: number): BatchShipmentSummary {
  const summary = { batchId: batch.batchId, successfulCount: batch.totalPackages, failedCount: 0, totalPostageCents: postageCents };
  return summary;
}

export function shouldAutoReconcileDispute(record: DisputeRecord, autoSettleMaxCents: number): boolean {
  if (record.isResolved) {
    return false;
  }
  return (record.chargebackCents <= autoSettleMaxCents);
}

export function computeTotalTaxOnCart(cart: ShoppingCart, rate: TaxRate): number {
  const subtotal = calculateCartSubtotalCents(cart.items);
  return Math.floor(((subtotal * rate.basisPoints) / 10000));
}

export function formatNotificationPreview(notif: OrderNotification): string {
  return ((((("[" + notif.channel) + "] To: ") + notif.recipientEmail) + " | ") + notif.subject);
}

export function markNotificationSent(notif: OrderNotification): OrderNotification {
  const updated = { notificationId: notif.notificationId, recipientEmail: notif.recipientEmail, subject: notif.subject, bodyText: notif.bodyText, channel: notif.channel, isSent: true };
  return updated;
}

export function evaluateExpressEligibility(subtotalCents: number, customerTier: string): boolean {
  if ((customerTier === "PLATINUM")) {
    return true;
  }
  return (subtotalCents >= 20000);
}

export function buildWarehouseStatusReport(warehouse: WarehouseLocation): string {
  const load = calculateWarehouseLoadPercent(warehouse);
  let status = "NORMAL";
  if ((load >= 90)) {
    status = "OVERLOADED";
  } else if ((load >= 75)) {
    status = "HIGH_TRAFFIC";
  }
  return (((((((warehouse.warehouseId + " (") + warehouse.name) + ") Load: ") + load.toString()) + "% [") + status) + "]");
}

export function canProcessImmediateRefund(profile: CustomerProfile, refundCents: number): boolean {
  if (profile.isSuspended) {
    return false;
  }
  if ((profile.tier === "PLATINUM")) {
    return (refundCents <= 50000);
  }
  if ((profile.tier === "GOLD")) {
    return (refundCents <= 25000);
  }
  return (refundCents <= 10000);
}

export function calculateFulfillmentSla(orderId: string, createdAt: number, isExpress: boolean, actualShippedAt: number): SlaEvaluationResult {
  let allowedHours = 48;
  if (isExpress) {
    allowedHours = 24;
  }
  const targetTimestamp = (createdAt + (allowedHours * 3600));
  const isBreached = (actualShippedAt > targetTimestamp);
  let reason = "ON_TIME";
  if (isBreached) {
    reason = "PROCESSING_DELAY";
  }
  const res = { orderId, targetDispatchTimestamp: targetTimestamp, isBreached, breachReason: reason };
  return res;
}

export function reconcilePaymentBatch(reportId: string, batchId: string, expectedCents: number, settledCents: number): ReconciliationReport {
  const diff = (expectedCents - settledCents);
  const isBalanced = (diff === 0);
  const rep = { reportId, batchId, expectedTotalCents: expectedCents, settledTotalCents: settledCents, discrepancyCents: diff, isBalanced };
  return rep;
}

export function checkCarrierRateExpired(rate: ShippingRate, quoteTimestamp: number, currentTimestamp: number): boolean {
  const maxAgeSeconds = 86400;
  return ((currentTimestamp - quoteTimestamp) > maxAgeSeconds);
}
