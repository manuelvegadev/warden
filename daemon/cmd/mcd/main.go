// mcd es el daemon de mc-server-gui: supervisa instancias de Minecraft y expone la API.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/manuelvega/mc-server-gui/daemon/internal/api"
	"github.com/manuelvega/mc-server-gui/daemon/internal/config"
	"github.com/manuelvega/mc-server-gui/daemon/internal/instance"
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

	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           api.NewRouter(cfg, mgr, version),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("mcd listening", "addr", cfg.Listen, "version", version, "data", cfg.DataDir)
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
	mgr.StopAll(shutdownCtx) // apaga limpio (stop → SIGTERM → SIGKILL) cada instancia
	_ = srv.Shutdown(shutdownCtx)
}
