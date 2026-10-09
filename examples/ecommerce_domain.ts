export interface Address {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  isResidential: boolean;
}

export function Address(street: string, city: string, province: string, postalCode: string, country: string, isResidential: boolean): Address {
  return { street, city, province, postalCode, country, isResidential };
}

export interface Money {
  amountInCents: number;
  currencyCode: string;
}

export function Money(amountInCents: number, currencyCode: string): Money {
  return { amountInCents, currencyCode };
}

export interface TaxRate {
  jurisdiction: string;
  basisPoints: number;
  isCompound: boolean;
}

export function TaxRate(jurisdiction: string, basisPoints: number, isCompound: boolean): TaxRate {
  return { jurisdiction, basisPoints, isCompound };
}

export interface DiscountCode {
  code: string;
  discountType: string;
  valueInCentsOrPercent: number;
  minimumSubtotalCents: number;
  expiresAtTimestamp: number;
  isActive: boolean;
}

export function DiscountCode(code: string, discountType: string, valueInCentsOrPercent: number, minimumSubtotalCents: number, expiresAtTimestamp: number, isActive: boolean): DiscountCode {
  return { code, discountType, valueInCentsOrPercent, minimumSubtotalCents, expiresAtTimestamp, isActive };
}

export interface ProductVariant {
  sku: string;
  title: string;
  priceCents: number;
  weightGrams: number;
  inventoryCount: number;
  isDigital: boolean;
}

export function ProductVariant(sku: string, title: string, priceCents: number, weightGrams: number, inventoryCount: number, isDigital: boolean): ProductVariant {
  return { sku, title, priceCents, weightGrams, inventoryCount, isDigital };
}

export interface ProductCategory {
  categoryId: string;
  name: string;
  parentCategoryId: string;
  taxExempt: boolean;
}

export function ProductCategory(categoryId: string, name: string, parentCategoryId: string, taxExempt: boolean): ProductCategory {
  return { categoryId, name, parentCategoryId, taxExempt };
}

export interface InventoryItem {
  sku: string;
  warehouseId: string;
  availableQuantity: number;
  reservedQuantity: number;
  reorderThreshold: number;
}

export function InventoryItem(sku: string, warehouseId: string, availableQuantity: number, reservedQuantity: number, reorderThreshold: number): InventoryItem {
  return { sku, warehouseId, availableQuantity, reservedQuantity, reorderThreshold };
}

export interface CustomerProfile {
  customerId: string;
  email: string;
  tier: string;
  lifetimeSpendCents: number;
  orderCount: number;
  isSuspended: boolean;
}

export function CustomerProfile(customerId: string, email: string, tier: string, lifetimeSpendCents: number, orderCount: number, isSuspended: boolean): CustomerProfile {
  return { customerId, email, tier, lifetimeSpendCents, orderCount, isSuspended };
}

export interface CartItem {
  sku: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
}

export function CartItem(sku: string, quantity: number, unitPriceCents: number, discountCents: number): CartItem {
  return { sku, quantity, unitPriceCents, discountCents };
}

export interface ShoppingCart {
  cartId: string;
  customerId: string;
  items: CartItem[];
  appliedDiscount: string;
  createdAt: number;
}

export function ShoppingCart(cartId: string, customerId: string, items: CartItem[], appliedDiscount: string, createdAt: number): ShoppingCart {
  return { cartId, customerId, items, appliedDiscount, createdAt };
}

export interface ShippingRate {
  carrier: string;
  serviceLevel: string;
  baseCostCents: number;
  perKilogramCents: number;
  estimatedDays: number;
}

export function ShippingRate(carrier: string, serviceLevel: string, baseCostCents: number, perKilogramCents: number, estimatedDays: number): ShippingRate {
  return { carrier, serviceLevel, baseCostCents, perKilogramCents, estimatedDays };
}

export interface PaymentDetails {
  paymentId: string;
  provider: string;
  amountCents: number;
  lastFourDigits: string;
  isAuthorized: boolean;
}

export function PaymentDetails(paymentId: string, provider: string, amountCents: number, lastFourDigits: string, isAuthorized: boolean): PaymentDetails {
  return { paymentId, provider, amountCents, lastFourDigits, isAuthorized };
}

export interface FraudScore {
  riskScore: number;
  riskLevel: string;
  reasons: string[];
}

export function FraudScore(riskScore: number, riskLevel: string, reasons: string[]): FraudScore {
  return { riskScore, riskLevel, reasons };
}

export interface AuditEntry {
  auditId: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  timestamp: number;
}

export function AuditEntry(auditId: string, action: string, entityType: string, entityId: string, actorId: string, timestamp: number): AuditEntry {
  return { auditId, action, entityType, entityId, actorId, timestamp };
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
}

export function InvoiceItem(description: string, quantity: number, unitCents: number, totalCents: number): InvoiceItem {
  return { description, quantity, unitCents, totalCents };
}

export interface InvoiceSummary {
  invoiceNumber: string;
  orderId: string;
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  issuedAt: number;
}

export function InvoiceSummary(invoiceNumber: string, orderId: string, subtotalCents: number, taxCents: number, shippingCents: number, totalCents: number, issuedAt: number): InvoiceSummary {
  return { invoiceNumber, orderId, subtotalCents, taxCents, shippingCents, totalCents, issuedAt };
}

export interface WarehouseLocation {
  warehouseId: string;
  name: string;
  region: string;
  capacityUnits: number;
  activeOrders: number;
}

export function WarehouseLocation(warehouseId: string, name: string, region: string, capacityUnits: number, activeOrders: number): WarehouseLocation {
  return { warehouseId, name, region, capacityUnits, activeOrders };
}

export interface CarrierConfig {
  carrierCode: string;
  apiUrl: string;
  accountNumber: string;
  trackingUrlTemplate: string;
}

export function CarrierConfig(carrierCode: string, apiUrl: string, accountNumber: string, trackingUrlTemplate: string): CarrierConfig {
  return { carrierCode, apiUrl, accountNumber, trackingUrlTemplate };
}

export function createMoney(amount: number, currency: string): Money {
  return { amountInCents: amount, currencyCode: currency };
}

export function formatCurrency(m: Money): string {
  const dollars = Math.floor((m.amountInCents / 100));
  const cents = (m.amountInCents % 100);
  const sign = "";
  if ((m.amountInCents < 0)) {
    const sign = "-";
  }
  return (((((m.currencyCode + " ") + sign) + dollars.toString()) + ".") + cents.toString());
}

export function addMoney(a: Money, b: Money): { ok: true; value: Money } | { ok: false; error: string } {
  if ((a.currencyCode !== b.currencyCode)) {
    return { ok: false, error: "Currency mismatch in addMoney" };
  }
  const sum = (a.amountInCents + b.amountInCents);
  return { ok: true, value: createMoney(sum, a.currencyCode) };
}

export function subtractMoney(a: Money, b: Money): { ok: true; value: Money } | { ok: false; error: string } {
  if ((a.currencyCode !== b.currencyCode)) {
    return { ok: false, error: "Currency mismatch in subtractMoney" };
  }
  const diff = (a.amountInCents - b.amountInCents);
  return { ok: true, value: createMoney(diff, a.currencyCode) };
}

export function multiplyMoney(m: Money, factor: number): Money {
  const total = (m.amountInCents * factor);
  return createMoney(total, m.currencyCode);
}

export function calculateSalesTax(subtotal: Money, rate: TaxRate): Money {
  const taxCents = Math.floor(((subtotal.amountInCents * rate.basisPoints) / 10000));
  return createMoney(taxCents, subtotal.currencyCode);
}

export function validateSku(sku: string): boolean {
  if ((sku.length < 6)) {
    return false;
  }
  if ((sku.length > 24)) {
    return false;
  }
  return true;
}

export function isExpired(code: DiscountCode, currentTimestamp: number): boolean {
  if (!(code.isActive)) {
    return true;
  }
  if ((code.expiresAtTimestamp <= 0)) {
    return false;
  }
  return (currentTimestamp > code.expiresAtTimestamp);
}

export function calculateDiscount(subtotal: Money, code: DiscountCode, currentTimestamp: number): { ok: true; value: Money } | { ok: false; error: string } {
  if (isExpired(code, currentTimestamp)) {
    return { ok: false, error: "Discount code expired" };
  }
  if ((subtotal.amountInCents < code.minimumSubtotalCents)) {
    return { ok: false, error: "Subtotal does not meet minimum requirement" };
  }
  if ((code.discountType === "PERCENT")) {
    const deduction = Math.floor(((subtotal.amountInCents * code.valueInCentsOrPercent) / 100));
    return { ok: true, value: createMoney(deduction, subtotal.currencyCode) };
  } else if ((code.discountType === "FIXED")) {
    const deduction = code.valueInCentsOrPercent;
    if ((deduction > subtotal.amountInCents)) {
      const deduction = subtotal.amountInCents;
    }
    return { ok: true, value: createMoney(deduction, subtotal.currencyCode) };
  } else {
    return { ok: false, error: "Unknown discount type" };
  }
}

export function evaluateCustomerTier(lifetimeSpendCents: number, orderCount: number): string {
  if (((lifetimeSpendCents >= 500000) && (orderCount >= 20))) {
    return "PLATINUM";
  } else if (((lifetimeSpendCents >= 200000) || (orderCount >= 10))) {
    return "GOLD";
  } else if (((lifetimeSpendCents >= 50000) || (orderCount >= 3))) {
    return "SILVER";
  } else {
    return "BRONZE";
  }
}

export function calculateLoyaltyPoints(spend: Money, tier: string): number {
  const baseDollars = Math.floor((spend.amountInCents / 100));
  if ((tier === "PLATINUM")) {
    return (baseDollars * 3);
  } else if ((tier === "GOLD")) {
    return (baseDollars * 2);
  } else if ((tier === "SILVER")) {
    return Math.floor(((baseDollars * 15) / 10));
  } else {
    return baseDollars;
  }
}

export function isStockAvailable(item: InventoryItem, requestedQty: number): boolean {
  const netAvailable = (item.availableQuantity - item.reservedQuantity);
  return (netAvailable >= requestedQty);
}

export function reserveStock(item: InventoryItem, qty: number): { ok: true; value: InventoryItem } | { ok: false; error: string } {
  if (!(isStockAvailable(item, qty))) {
    return { ok: false, error: "Insufficient inventory to reserve" };
  }
  const updated = { sku: item.sku, warehouseId: item.warehouseId, availableQuantity: item.availableQuantity, reservedQuantity: (item.reservedQuantity + qty), reorderThreshold: item.reorderThreshold };
  return { ok: true, value: updated };
}

export function releaseStock(item: InventoryItem, qty: number): InventoryItem {
  const newReserved = (item.reservedQuantity - qty);
  if ((newReserved < 0)) {
    const newReserved = 0;
  }
  const updated = { sku: item.sku, warehouseId: item.warehouseId, availableQuantity: item.availableQuantity, reservedQuantity: newReserved, reorderThreshold: item.reorderThreshold };
  return updated;
}

export function commitStock(item: InventoryItem, qty: number): { ok: true; value: InventoryItem } | { ok: false; error: string } {
  if ((item.reservedQuantity < qty)) {
    return { ok: false, error: "Cannot commit more stock than reserved" };
  }
  const updated = { sku: item.sku, warehouseId: item.warehouseId, availableQuantity: (item.availableQuantity - qty), reservedQuantity: (item.reservedQuantity - qty), reorderThreshold: item.reorderThreshold };
  return { ok: true, value: updated };
}

export function checkReorderNeeded(item: InventoryItem): boolean {
  const net = (item.availableQuantity - item.reservedQuantity);
  return (net <= item.reorderThreshold);
}

export function calculateItemTotal(item: CartItem): number {
  const raw = (item.quantity * item.unitPriceCents);
  const net = (raw - item.discountCents);
  if ((net < 0)) {
    return 0;
  }
  return net;
}

export function calculateCartSubtotalCents(items: CartItem[]): number {
  let sum = 0;
  for (const item of items) {
    sum = (sum + calculateItemTotal(item));
  }
  return sum;
}

export function calculateCartWeightGrams(items: CartItem[], avgWeightPerItem: number): number {
  let totalCount = 0;
  for (const item of items) {
    totalCount = (totalCount + item.quantity);
  }
  return (totalCount * avgWeightPerItem);
}

export function calculateShippingCost(weightGrams: number, distanceKm: number, rate: ShippingRate): Money {
  const weightKg = Math.floor((weightGrams / 1000));
  if (((weightGrams % 1000) > 0)) {
    const weightKg = (weightKg + 1);
  }
  const variableCost = (weightKg * rate.perKilogramCents);
  const distanceFactor = Math.floor((distanceKm / 100));
  const totalCents = ((rate.baseCostCents + variableCost) + (distanceFactor * 50));
  return createMoney(totalCents, "USD");
}

export function validateOrderTransition(currentStatus: string, nextStatus: string): boolean {
  if ((currentStatus === "PENDING")) {
    return ((nextStatus === "AUTHORIZED") || (nextStatus === "CANCELLED"));
  } else if ((currentStatus === "AUTHORIZED")) {
    return ((nextStatus === "PROCESSING") || (nextStatus === "VOIDED"));
  } else if ((currentStatus === "PROCESSING")) {
    return ((nextStatus === "SHIPPED") || (nextStatus === "CANCELLED"));
  } else if ((currentStatus === "SHIPPED")) {
    return ((nextStatus === "DELIVERED") || (nextStatus === "RETURNED"));
  } else if ((currentStatus === "DELIVERED")) {
    return ((nextStatus === "REFUNDED") || (nextStatus === "COMPLETED"));
  } else {
    return false;
  }
}

export function calculateRiskScore(profile: CustomerProfile, amountCents: number, isNewAddress: boolean): FraudScore {
  let score = 0;
  let reasons: string[] = [];
  if (profile.isSuspended) {
    score = (score + 90);
    reasons = [...reasons, "Customer account is currently suspended"];
  }
  if ((amountCents > 100000)) {
    score = (score + 30);
    reasons = [...reasons, "High single transaction amount exceeding $1000"];
  }
  if ((isNewAddress && (profile.orderCount === 0))) {
    score = (score + 25);
    reasons = [...reasons, "First time customer ordering to unverified shipping address"];
  }
  if (((profile.orderCount > 10) && (profile.lifetimeSpendCents > 200000))) {
    score = (score - 20);
    reasons = [...reasons, "Established customer with high lifetime spend"];
  }
  if ((score < 0)) {
    score = 0;
  }
  let level = "LOW";
  if ((score >= 75)) {
    level = "CRITICAL";
  } else if ((score >= 50)) {
    level = "HIGH";
  } else if ((score >= 25)) {
    level = "MEDIUM";
  }
  const res = { riskScore: score, riskLevel: level, reasons };
  return res;
}

export function generateInvoiceNumber(orderId: string, issuedTimestamp: number): string {
  return ((("INV-" + orderId) + "-") + issuedTimestamp.toString());
}

export function calculateLineItemTotal(quantity: number, unitCents: number): InvoiceItem {
  const total = (quantity * unitCents);
  return { description: "Standard Merchandise", quantity, unitCents, totalCents: total };
}

export function buildInvoiceSummary(invoiceNum: string, orderId: string, subtotal: number, tax: number, shipping: number, timestamp: number): InvoiceSummary {
  const grandTotal = ((subtotal + tax) + shipping);
  return { invoiceNumber: invoiceNum, orderId, subtotalCents: subtotal, taxCents: tax, shippingCents: shipping, totalCents: grandTotal, issuedAt: timestamp };
}

export function formatAuditEntry(entry: AuditEntry): string {
  return ((((((((("[" + entry.timestamp.toString()) + "] Actor ") + entry.actorId) + " executed ") + entry.action) + " on ") + entry.entityType) + ":") + entry.entityId);
}

export function isWarehouseOverCapacity(wh: WarehouseLocation): boolean {
  return (wh.activeOrders >= wh.capacityUnits);
}

export function calculateWarehouseLoadPercent(wh: WarehouseLocation): number {
  if ((wh.capacityUnits === 0)) {
    return 100;
  }
  return Math.floor(((wh.activeOrders * 100) / wh.capacityUnits));
}

export function generateTrackingUrl(template: string, trackingNumber: string): string {
  return (template + trackingNumber);
}

export function createCustomer(id: string, email: string): CustomerProfile {
  return { customerId: id, email, tier: "BRONZE", lifetimeSpendCents: 0, orderCount: 0, isSuspended: false };
}

export function updateCustomerSpend(profile: CustomerProfile, spendCents: number): CustomerProfile {
  const newSpend = (profile.lifetimeSpendCents + spendCents);
  const newCount = (profile.orderCount + 1);
  const newTier = evaluateCustomerTier(newSpend, newCount);
  const updated = { customerId: profile.customerId, email: profile.email, tier: newTier, lifetimeSpendCents: newSpend, orderCount: newCount, isSuspended: profile.isSuspended };
  return updated;
}

export function suspendCustomer(profile: CustomerProfile, reason: string): CustomerProfile {
  const updated = { customerId: profile.customerId, email: profile.email, tier: profile.tier, lifetimeSpendCents: profile.lifetimeSpendCents, orderCount: profile.orderCount, isSuspended: true };
  return updated;
}

export function reinstateCustomer(profile: CustomerProfile): CustomerProfile {
  const updated = { customerId: profile.customerId, email: profile.email, tier: profile.tier, lifetimeSpendCents: profile.lifetimeSpendCents, orderCount: profile.orderCount, isSuspended: false };
  return updated;
}

export function sanitizeAddress(rawStreet: string, rawCity: string, rawPostal: string): Address {
  const cleanStreet = rawStreet.trim();
  const cleanCity = rawCity.trim();
  const cleanPostal = rawPostal.trim();
  return { street: cleanStreet, city: cleanCity, province: "CA", postalCode: cleanPostal, country: "USA", isResidential: true };
}

export function isDomesticShipment(dest: Address, originCountry: string): boolean {
  return (dest.country === originCountry);
}

export function estimateDeliveryDate(shipTimestamp: number, transitDays: number): number {
  return (shipTimestamp + (transitDays * 86400));
}

export function createProductVariant(sku: string, title: string, priceCents: number, weight: number): ProductVariant {
  return { sku, title, priceCents, weightGrams: weight, inventoryCount: 100, isDigital: false };
}

export function createDigitalProductVariant(sku: string, title: string, priceCents: number): ProductVariant {
  return { sku, title, priceCents, weightGrams: 0, inventoryCount: 999999, isDigital: true };
}

export function computeBulkDiscount(quantity: number, basePriceCents: number): number {
  if ((quantity >= 100)) {
    return Math.floor(((basePriceCents * 20) / 100));
  } else if ((quantity >= 50)) {
    return Math.floor(((basePriceCents * 15) / 100));
  } else if ((quantity >= 20)) {
    return Math.floor(((basePriceCents * 10) / 100));
  } else if ((quantity >= 10)) {
    return Math.floor(((basePriceCents * 5) / 100));
  } else {
    return 0;
  }
}

export function calculateFinalCartItemPrice(quantity: number, unitPriceCents: number): CartItem {
  const discountPerUnit = computeBulkDiscount(quantity, unitPriceCents);
  const totalDiscount = (discountPerUnit * quantity);
  return { sku: "AUTO-SKU", quantity, unitPriceCents, discountCents: totalDiscount };
}

export function isEligibleForFreeShipping(subtotalCents: number, thresholdCents: number): boolean {
  return (subtotalCents >= thresholdCents);
}

export function applyTaxExemption(rate: TaxRate, category: ProductCategory): TaxRate {
  if (category.taxExempt) {
    const zeroTax = { jurisdiction: rate.jurisdiction, basisPoints: 0, isCompound: false };
    return zeroTax;
  } else {
    return rate;
  }
}

export function calculateCompoundedTax(subtotalCents: number, stateRate: TaxRate, municipalRate: TaxRate): number {
  const stateTax = Math.floor(((subtotalCents * stateRate.basisPoints) / 10000));
  const taxableBase = subtotalCents;
  if (stateRate.isCompound) {
    const taxableBase = (taxableBase + stateTax);
  }
  const municipalTax = Math.floor(((taxableBase * municipalRate.basisPoints) / 10000));
  return (stateTax + municipalTax);
}

export function formatReceiptLine(sku: string, title: string, qty: number, cents: number): string {
  const dollars = Math.floor((cents / 100));
  const frac = (cents % 100);
  return ((((((((sku + " - ") + title) + " x") + qty.toString()) + " = $") + dollars.toString()) + ".") + frac.toString());
}

export function parseCurrencyCode(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const clean = raw.trim();
  if (((((clean === "USD") || (clean === "EUR")) || (clean === "GBP")) || (clean === "CAD"))) {
    return { ok: true, value: clean };
  } else {
    return { ok: false, error: "Unsupported currency code" };
  }
}

export function calculateRestockingFee(itemPriceCents: number, isOpened: boolean): number {
  if (isOpened) {
    return Math.floor(((itemPriceCents * 15) / 100));
  } else {
    return Math.floor(((itemPriceCents * 5) / 100));
  }
}

export function computeNetRefundCents(paidCents: number, feeCents: number): number {
  const net = (paidCents - feeCents);
  if ((net < 0)) {
    return 0;
  } else {
    return net;
  }
}
