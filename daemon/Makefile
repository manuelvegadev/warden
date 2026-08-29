VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS = -s -w -X main.version=$(VERSION)

.PHONY: build run test lint linux
build:
	go build -ldflags '$(LDFLAGS)' -o bin/mcd ./cmd/mcd
run:
	MCD_LOG_LEVEL=debug MCD_ALLOWED_ORIGINS=http://localhost:3000 go run ./cmd/mcd
test:
	go test ./...
linux:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags '$(LDFLAGS)' -o bin/mcd-linux-amd64 ./cmd/mcd
