package server

import "fmt"

type Config struct {
	Port int
	Host string
}

func StartServer(cfg Config) string {
	return fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
}
