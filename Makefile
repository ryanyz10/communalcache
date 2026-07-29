.PHONY: test vet web-build docker-build migrate-check boundary-http

test:
	go test ./...

vet:
	go vet ./...

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
# Requires: HOSTED_DATABASE_URL SUPABASE_URL SUPABASE_ANON_KEY BOUNDARY_USER_JWT
boundary-http:
	@test -n "$$HOSTED_DATABASE_URL" || (echo "HOSTED_DATABASE_URL required" && exit 1)
	@test -n "$$SUPABASE_URL" || (echo "SUPABASE_URL required" && exit 1)
	@test -n "$$SUPABASE_ANON_KEY" || (echo "SUPABASE_ANON_KEY required" && exit 1)
	@test -n "$$BOUNDARY_USER_JWT" || (echo "BOUNDARY_USER_JWT required" && exit 1)
	go test -tags=hosted ./internal/db -count=1 -run TestHostedPostgRESTBoundary -v
