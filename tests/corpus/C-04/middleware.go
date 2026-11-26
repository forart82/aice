package gateway

import (
	"encoding/json"
	"net/http"
	"sync"
)

type RateLimiter struct {
	mu       sync.Mutex
	counters map[string]int
	maxHits  int
}

func NewRateLimiter(maxHits int) *RateLimiter {
	return &RateLimiter{
		counters: make(map[string]int),
		maxHits:  maxHits,
	}
}

func (rl *RateLimiter) Allow(clientID string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	count := rl.counters[clientID]
	if count >= rl.maxHits {
		return false
	}
	rl.counters[clientID] = count + 1
	return true
}

func WriteJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func WriteError(w http.ResponseWriter, status int, code string, msg string) {
	WriteJSON(w, status, ErrorEnvelope{Code: code, Message: msg})
}

func AuthAndRateLimit(rl *RateLimiter, expectedToken string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("X-Gateway-Token")
		if token == "" || token != expectedToken {
			WriteError(w, http.StatusUnauthorized, "unauthorized", "invalid gateway token")
			return
		}
		clientID := r.Header.Get("X-Client-Id")
		if clientID == "" {
			clientID = r.RemoteAddr
		}
		if !rl.Allow(clientID) {
			WriteError(w, http.StatusTooManyRequests, "rate_limited", "request quota exceeded")
			return
		}
		next.ServeHTTP(w, r)
	})
}
