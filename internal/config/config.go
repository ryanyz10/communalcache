package config

import (
	"fmt"
	"os"
)

type Config struct {
	DatabaseURL            string
	SupabaseURL            string
	SupabaseAnonKey        string
	SupabaseServiceRoleKey string
	ResendAPIKey           string
	EmailFrom              string
	VAPIDPublicKey         string
	VAPIDPrivateKey        string
	AppBaseURL             string
	ListenAddr             string
}

func Load() (Config, error) {
	c := Config{
		DatabaseURL:            os.Getenv("DATABASE_URL"),
		SupabaseURL:            os.Getenv("SUPABASE_URL"),
		SupabaseAnonKey:        os.Getenv("SUPABASE_ANON_KEY"),
		SupabaseServiceRoleKey: os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
		ResendAPIKey:           os.Getenv("RESEND_API_KEY"),
		EmailFrom:              os.Getenv("EMAIL_FROM"),
		VAPIDPublicKey:         os.Getenv("VAPID_PUBLIC_KEY"),
		VAPIDPrivateKey:        os.Getenv("VAPID_PRIVATE_KEY"),
		AppBaseURL:             os.Getenv("APP_BASE_URL"),
		ListenAddr:             envOr("LISTEN_ADDR", ":8080"),
	}
	for _, check := range []struct {
		name, val string
	}{
		{"DATABASE_URL", c.DatabaseURL},
		{"SUPABASE_URL", c.SupabaseURL},
		{"SUPABASE_ANON_KEY", c.SupabaseAnonKey},
		{"APP_BASE_URL", c.AppBaseURL},
	} {
		if check.val == "" {
			return c, fmt.Errorf("%s is required", check.name)
		}
	}
	return c, nil
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
