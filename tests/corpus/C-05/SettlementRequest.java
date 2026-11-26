package com.aice.settlement;

import java.util.Objects;

public final class SettlementRequest {
    private final String settlementId;
    private final String merchantId;
    private final String sourceCurrency;
    private final String targetCurrency;
    private final long grossMinorUnits;
    private final int feeBasisPoints;

    public SettlementRequest(
            String settlementId,
            String merchantId,
            String sourceCurrency,
            String targetCurrency,
            long grossMinorUnits,
            int feeBasisPoints) {
        this.settlementId = Objects.requireNonNull(settlementId, "settlementId");
        this.merchantId = Objects.requireNonNull(merchantId, "merchantId");
        this.sourceCurrency = Objects.requireNonNull(sourceCurrency, "sourceCurrency");
        this.targetCurrency = Objects.requireNonNull(targetCurrency, "targetCurrency");
        if (grossMinorUnits <= 0) {
            throw new IllegalArgumentException("grossMinorUnits must be positive");
        }
        if (feeBasisPoints < 0 || feeBasisPoints > 2_500) {
            throw new IllegalArgumentException("feeBasisPoints out of bounds");
        }
        this.grossMinorUnits = grossMinorUnits;
        this.feeBasisPoints = feeBasisPoints;
    }

    public String getSettlementId() { return settlementId; }
    public String getMerchantId() { return merchantId; }
    public String getSourceCurrency() { return sourceCurrency; }
    public String getTargetCurrency() { return targetCurrency; }
    public long getGrossMinorUnits() { return grossMinorUnits; }
    public int getFeeBasisPoints() { return feeBasisPoints; }
}
