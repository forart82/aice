package gateway

import (
	"encoding/json"
	"net/http"
	"sync"
)

type GatewayService struct {
	mu      sync.Mutex
	seen    map[string]SettlementResponse
	feeBps  int64
}

func NewGatewayService(feeBps int64) *GatewayService {
	return &GatewayService{
		seen:   make(map[string]SettlementResponse),
		feeBps: feeBps,
	}
}

func (s *GatewayService) HandleSettlement(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "use POST")
		return
	}
	var req SettlementRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if err := req.Validate(); err != nil {
		WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if cached, ok := s.seen[req.IdempotencyKey]; ok {
		WriteJSON(w, http.StatusOK, cached)
		return
	}
	fee := (req.AmountCents * s.feeBps) / 10_000
	resp := SettlementResponse{
		SettlementID: "stl_" + req.IdempotencyKey,
		Status:       "settled",
		NetCents:     req.AmountCents - fee,
		FeeCents:     fee,
	}
	s.seen[req.IdempotencyKey] = resp
	WriteJSON(w, http.StatusCreated, resp)
}

func (s *GatewayService) HandleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "use GET")
		return
	}
	key := r.URL.Query().Get("key")
	if key == "" {
		WriteError(w, http.StatusBadRequest, "missing_key", "key query param is required")
		return
	}
	s.mu.Lock()
	resp, ok := s.seen[key]
	s.mu.Unlock()
	if !ok {
		WriteError(w, http.StatusNotFound, "not_found", "settlement not found")
		return
	}
	WriteJSON(w, http.StatusOK, resp)
}

func (s *GatewayService) HandleHealth(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *GatewayService) HandleRefund(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "use POST")
		return
	}
	var req SettlementRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if err := req.Validate(); err != nil {
		WriteError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, ok := s.seen[req.IdempotencyKey]
	if !ok {
		WriteError(w, http.StatusNotFound, "not_found", "original settlement not found")
		return
	}
	if req.AmountCents > existing.NetCents+existing.FeeCents {
		WriteError(w, http.StatusConflict, "amount_exceeded", "refund exceeds original amount")
		return
	}
	refunded := SettlementResponse{
		SettlementID: existing.SettlementID,
		Status:       "refunded",
		NetCents:     0,
		FeeCents:     existing.FeeCents,
	}
	s.seen[req.IdempotencyKey] = refunded
	WriteJSON(w, http.StatusOK, refunded)
}

func (s *GatewayService) HandleMetrics(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	total := len(s.seen)
	var settledVolume int64
	for _, item := range s.seen {
		if item.Status == "settled" {
			settledVolume += item.NetCents
		}
	}
	s.mu.Unlock()
	WriteJSON(w, http.StatusOK, map[string]any{
		"totalRecords":      total,
		"settledNetCents":   settledVolume,
		"configuredFeeBps":  s.feeBps,
	})
}
