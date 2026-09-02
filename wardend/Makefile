VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS = -s -w -X main.version=$(VERSION)

.PHONY: build run test lint linux agent
build:
	go build -ldflags '$(LDFLAGS)' -o bin/wardend ./cmd/wardend
# The Warden Agent plugin (agent/, Gradle; the wrapper fetches Gradle and a JDK 25 toolchain) is
# embedded in the daemon from internal/agent/dist. Without it the daemon builds and runs, but the
# live view cannot be enabled (ADR-018).
agent:
	cd ../agent && ./gradlew build -q
	cp ../agent/build/libs/WardenAgent.jar internal/agent/dist/WardenAgent.jar
# Local dev against Beacon on http://localhost:3000. PANEL_KEY must match WARDEND_PANEL_KEY in beacon/.env.local.
PANEL_KEY ?= $(shell grep -s '^WARDEND_PANEL_KEY=' ../beacon/.env.local | cut -d= -f2)
run:
	WARDEND_LOG_LEVEL=debug \
	WARDEND_ALLOWED_ORIGINS=http://localhost:3000 \
	WARDEND_PANEL_JWKS_URL=http://localhost:3000/api/auth/jwks \
	WARDEND_PANEL_ISSUER=http://localhost:3000 \
	WARDEND_PANEL_KEY=$(PANEL_KEY) \
	go run ./cmd/wardend
# lint + test are what CI runs (.github/workflows/ci.yml).
lint:
	@out=$$(gofmt -l ./cmd ./internal); if [ -n "$$out" ]; then echo "gofmt needed:"; echo "$$out"; exit 1; fi
	go vet ./...
test:
	go test -race -count=1 ./...
# make linux [GOARCH=arm64] [VERSION=v1.2.3] — release binaries carry the agent.
GOARCH ?= amd64
linux: agent
	CGO_ENABLED=0 GOOS=linux GOARCH=$(GOARCH) go build -ldflags '$(LDFLAGS)' -o bin/wardend-linux-$(GOARCH) ./cmd/wardend
