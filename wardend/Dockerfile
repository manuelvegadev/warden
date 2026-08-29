# Optional container image for wardend. The recommended deployment is the systemd unit
# (deploy/); use this when the Minecraft host itself runs containers. Java runtimes are
# downloaded into the data volume at runtime, so the image stays small.
# Cross-compile on the build platform (no QEMU for the Go stage); the runtime stage is per target arch.
FROM --platform=$BUILDPLATFORM golang:1.25-bookworm AS build
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
COPY cmd ./cmd
COPY internal ./internal
ARG VERSION=docker
# Module and build caches survive between builds (BuildKit cache mounts).
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build -ldflags "-s -w -X main.version=${VERSION}" -o /wardend ./cmd/wardend

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /data --shell /usr/sbin/nologin warden \
 && install -d -o warden -g warden /data
COPY --from=build /wardend /usr/local/bin/wardend
USER warden
VOLUME ["/data"]
# Everything else keeps the daemon's defaults (docs/deploy.md); :8080 is the default listen address.
ENV WARDEND_DATA_DIR=/data
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/wardend"]
