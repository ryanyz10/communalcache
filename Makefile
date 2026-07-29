# Local dev env (gitignored). Leading dash: absent in CI and on fresh clones.
-include .env
export DATABASE_URL SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY
export RESEND_API_KEY EMAIL_FROM VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY
export APP_BASE_URL LISTEN_ADDR
export TEST_DATABASE_URL

.PHONY: test vet dev web-build docker-build migrate-check boundary-http

test:
	go test ./...

vet:
	go vet ./...

dev:
	go run ./cmd/server

web-install:
	cd web && npm ci

web-build: web-install
	cd web && npm run build
	rm -rf cmd/server/dist && cp -R web/dist cmd/server/dist

docker-build:
	docker build -t communalcache .

# Requires TEST_DATABASE_URL (session-mode / direct Postgres).
migrate-check:
	@test -n "$$TEST_DATABASE_URL" || (echo "TEST_DATABASE_URL required" && exit 1)
	go test ./internal/db -count=1 -v

# Hosted PostgREST boundary. Never uses TEST_DATABASE_URL.
# Requires: SUPABASE_URL SUPABASE_ANON_KEY (from .env).
boundary-http:
	@test -n "$$SUPABASE_URL" || (echo "SUPABASE_URL required" && exit 1)
	@test -n "$$SUPABASE_ANON_KEY" || (echo "SUPABASE_ANON_KEY required" && exit 1)
	go test -tags=hosted ./internal/db -count=1 -run TestHostedPostgRESTBoundary -v
