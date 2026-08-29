// wardend is the warden daemon: it supervises Minecraft instances and exposes the API.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/manuelvega/warden/wardend/internal/api"
	"github.com/manuelvega/warden/wardend/internal/auth"
	"github.com/manuelvega/warden/wardend/internal/config"
	"github.com/manuelvega/warden/wardend/internal/instance"
)

var version = "dev"

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("config", "err", err)
		os.Exit(1)
	}
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel()}))
	slog.SetDefault(logger)

	if err := os.MkdirAll(cfg.ServersDir(), 0o750); err != nil {
		slog.Error("data dir", "err", err)
		os.Exit(1)
	}

	mgr := instance.NewManager(cfg.ServersDir())
	if err := mgr.LoadAll(); err != nil {
		slog.Error("load instances", "err", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	verifier, err := auth.NewVerifier(ctx, auth.Options{JWKSURL: cfg.PanelJWKSURL, Issuer: cfg.PanelIssuer, PanelKey: cfg.PanelKey})
	if err != nil {
		slog.Error("auth", "err", err)
		os.Exit(1)
	}

	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           api.NewRouter(cfg, mgr, verifier, version),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		slog.Info("wardend listening", "addr", cfg.Listen, "version", version, "data", cfg.DataDir)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("http", "err", err)
			stop()
		}
	}()

	mgr.AutostartAll(ctx)

	<-ctx.Done()
	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	mgr.StopAll(shutdownCtx) // clean shutdown (stop → SIGTERM → SIGKILL) of every instance
	_ = srv.Shutdown(shutdownCtx)
}
