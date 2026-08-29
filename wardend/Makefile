VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS = -s -w -X main.version=$(VERSION)

.PHONY: build run test lint linux
build:
	go build -ldflags '$(LDFLAGS)' -o bin/wardend ./cmd/wardend
run:
	WARDEND_LOG_LEVEL=debug WARDEND_ALLOWED_ORIGINS=http://localhost:3000 go run ./cmd/wardend
test:
	go test ./...
linux:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags '$(LDFLAGS)' -o bin/wardend-linux-amd64 ./cmd/wardend
