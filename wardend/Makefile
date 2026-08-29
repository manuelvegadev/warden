VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS = -s -w -X main.version=$(VERSION)

.PHONY: build run test lint linux
build:
	go build -ldflags '$(LDFLAGS)' -o bin/wardend ./cmd/wardend
# Local dev against Beacon on http://localhost:3000. PANEL_KEY must match WARDEND_PANEL_KEY in beacon/.env.local.
PANEL_KEY ?= $(shell grep -s '^WARDEND_PANEL_KEY=' ../beacon/.env.local | cut -d= -f2)
run:
	WARDEND_LOG_LEVEL=debug \
	WARDEND_ALLOWED_ORIGINS=http://localhost:3000 \
	WARDEND_PANEL_JWKS_URL=http://localhost:3000/api/auth/jwks \
	WARDEND_PANEL_ISSUER=http://localhost:3000 \
	WARDEND_PANEL_KEY=$(PANEL_KEY) \
	go run ./cmd/wardend
test:
	go test ./...
linux:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags '$(LDFLAGS)' -o bin/wardend-linux-amd64 ./cmd/wardend
