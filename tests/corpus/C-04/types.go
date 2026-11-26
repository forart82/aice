package gateway

import "errors"

var (
	ErrMissingIdempotencyKey = errors.New("missing idempotency key")
	ErrInvalidAmount         = errors.New("amount must be positive")
	ErrUnsupportedCurrency   = errors.New("unsupported currency")
)

type SettlementRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
	MerchantID     string `json:"merchantId"`
	Currency       string `json:"currency"`
	AmountCents    int64  `json:"amountCents"`
	Reference      string `json:"reference"`
}

type SettlementResponse struct {
	SettlementID string `json:"settlementId"`
	Status       string `json:"status"`
	NetCents     int64  `json:"netCents"`
	FeeCents     int64  `json:"feeCents"`
}

type ErrorEnvelope struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (r *SettlementRequest) Validate() error {
	if r.IdempotencyKey == "" {
		return ErrMissingIdempotencyKey
	}
	if r.AmountCents <= 0 {
		return ErrInvalidAmount
	}
	switch r.Currency {
	case "USD", "EUR", "GBP":
		return nil
	default:
		return ErrUnsupportedCurrency
	}
}
