.PHONY: test vet web-build docker-build migrate-check

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
