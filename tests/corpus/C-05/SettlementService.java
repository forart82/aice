package com.aice.settlement;

import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public class SettlementService {
    private final Map<String, Long> fxRatesMicro = new HashMap<>();
    private final Map<String, Long> settledLedger = new HashMap<>();

    public SettlementService() {
        fxRatesMicro.put("USD:USD", 1_000_000L);
        fxRatesMicro.put("EUR:USD", 1_085_000L);
        fxRatesMicro.put("GBP:USD", 1_270_000L);
        fxRatesMicro.put("USD:EUR", 921_659L);
    }

    /**
     * Converts and settles a multi-currency payment request into the merchant ledger.
     */
    public long settle(SettlementRequest req) {
        Objects.requireNonNull(req, "req");
        if (req.getSettlementId().isBlank()) {
            throw new IllegalArgumentException("settlementId must not be blank");
        }
        if (req.getMerchantId().isBlank()) {
            throw new IllegalArgumentException("merchantId must not be blank");
        }
        String pair = req.getSourceCurrency() + ":" + req.getTargetCurrency();
        Long rate = fxRatesMicro.get(pair);
        if (rate == null) {
            throw new IllegalStateException("Unsupported FX pair: " + pair);
        }
        long converted = Math.multiplyExact(req.getGrossMinorUnits(), rate) / 1_000_000L;
        long fee = computeFee(converted, req.getFeeBasisPoints());
        long net = converted - fee;
        settledLedger.merge(req.getMerchantId(), net, Long::sum);
        return net;
    }

    public long computeFee(long amountMinorUnits, int basisPoints) {
        if (amountMinorUnits <= 0 || basisPoints <= 0) {
            return 0L;
        }
        return (amountMinorUnits * basisPoints + 5_000L) / 10_000L;
    }

    public long ledgerBalance(String merchantId) {
        Objects.requireNonNull(merchantId, "merchantId");
        return settledLedger.getOrDefault(merchantId, 0L);
    }

    public long refund(SettlementRequest req) {
        Objects.requireNonNull(req, "req");
        if (req.getSettlementId().isBlank()) {
            throw new IllegalArgumentException("settlementId must not be blank");
        }
        if (req.getMerchantId().isBlank()) {
            throw new IllegalArgumentException("merchantId must not be blank");
        }
        String pair = req.getSourceCurrency() + ":" + req.getTargetCurrency();
        Long rate = fxRatesMicro.get(pair);
        if (rate == null) {
            throw new IllegalStateException("Unsupported FX pair: " + pair);
        }
        long converted = Math.multiplyExact(req.getGrossMinorUnits(), rate) / 1_000_000L;
        long current = settledLedger.getOrDefault(req.getMerchantId(), 0L);
        if (current < converted) {
            throw new IllegalStateException("Insufficient merchant balance for refund");
        }
        long updated = current - converted;
        settledLedger.put(req.getMerchantId(), updated);
        return updated;
    }

    public boolean supportsCurrencyPair(String sourceCurrency, String targetCurrency) {
        if (sourceCurrency == null || targetCurrency == null) {
            return false;
        }
        return fxRatesMicro.containsKey(sourceCurrency + ":" + targetCurrency);
    }

    public void registerFxRate(String sourceCurrency, String targetCurrency, long microRate) {
        Objects.requireNonNull(sourceCurrency, "sourceCurrency");
        Objects.requireNonNull(targetCurrency, "targetCurrency");
        if (microRate <= 0L) {
            throw new IllegalArgumentException("microRate must be positive");
        }
        fxRatesMicro.put(sourceCurrency + ":" + targetCurrency, microRate);
    }
}
