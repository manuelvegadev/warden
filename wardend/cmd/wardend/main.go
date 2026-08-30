// wardend is the Warden daemon: it supervises Minecraft instances and exposes the API consumed by Beacon.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/manuelvega/warden/wardend/internal/api"
	"github.com/manuelvega/warden/wardend/internal/auth"
	"github.com/manuelvega/warden/wardend/internal/catalog"
	"github.com/manuelvega/warden/wardend/internal/config"
	"github.com/manuelvega/warden/wardend/internal/installer"
	"github.com/manuelvega/warden/wardend/internal/instance"
	"github.com/manuelvega/warden/wardend/internal/java"
	"github.com/manuelvega/warden/wardend/internal/metrics"
	"github.com/manuelvega/warden/wardend/internal/mojang"
	"github.com/manuelvega/warden/wardend/internal/selfupdate"
	"github.com/manuelvega/warden/wardend/internal/skins"
	"github.com/manuelvega/warden/wardend/internal/store"
	"github.com/manuelvega/warden/wardend/internal/tasks"
	"github.com/manuelvega/warden/wardend/internal/tlsconf"
	"github.com/manuelvega/warden/wardend/internal/ws"
)

var version = "dev"

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "install":
			if err := installer.Run(version, os.Args[2:]); err != nil {
				os.Exit(1)
			}
			return
		case "update-apply": // root half of the self-update; run by wardend-update.service
			dir := ""
			if len(os.Args) > 2 {
				dir = os.Args[2]
			}
			if err := selfupdate.Apply(context.Background(), dir, os.Stdout); err != nil {
				fmt.Fprintln(os.Stderr, "update-apply:", err)
				os.Exit(1)
			}
			return
		case "version", "--version", "-v":
			fmt.Println("wardend", version)
			return
		case "help", "--help", "-h":
			fmt.Println("usage: wardend            run the daemon (configuration from WARDEND_* env)\n       wardend install    interactive setup as a systemd service (root); --yes, --beacon-image\n       wardend version\n       wardend update-apply <dir>   install a staged update (root; used by wardend-update.service)")
			return
		}
	}
	cfg, err := config.Load()
	if err != nil {
		slog.Error("config", "err", err)
		os.Exit(1)
	}
	// TLS material is validated and loaded before anything else so a bad setup fails at once.
	tlsCfg, acmeHTTP, err := tlsconf.Build(cfg.TLS)
	if err != nil {
		slog.Error("tls", "err", err)
		os.Exit(1)
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel()})))

	if err := os.MkdirAll(cfg.ServersDir(), 0o750); err != nil {
		slog.Error("data dir", "err", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	verifier, err := auth.NewVerifier(ctx, auth.Options{JWKSURL: cfg.PanelJWKSURL, Issuer: cfg.PanelIssuer, PanelKey: cfg.PanelKey})
	if err != nil {
		slog.Error("auth", "err", err)
		os.Exit(1)
	}

	st, err := store.Open(cfg.DBPath())
	if err != nil {
		slog.Error("store", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	mgr := instance.NewManager(cfg.ServersDir(), nil)
	hub := ws.NewHub(verifier, mgr, cfg.AllowedOrigins)
	mgr.SetBroadcaster(hub)
	mgr.SetEventSink(st)
	if err := mgr.LoadAll(); err != nil {
		slog.Error("load instances", "err", err)
		os.Exit(1)
	}

	reg := catalog.NewRegistry(cfg.UserAgent(version))
	mj := mojang.New(cfg.UserAgent(version))
	instance.SetMojang(mj)
	jm := java.NewManager(cfg.DataDir, reg, cfg.UserAgent(version))
	mgr.SetJavaResolver(jm)
	tm := tasks.NewManager(hub)
	sampler := metrics.NewSampler(mgr, st, hub, cfg.DataDir, reg.TraitsOf)
	sk := skins.New(cfg.DataDir, mj)
	var sched *instance.BackupScheduler
	sched = instance.NewBackupScheduler(mgr, func(inst *instance.Instance) {
		tm.Run(ctx, "backup", inst.Manifest.ID, func(ctx context.Context, report tasks.Reporter) error {
			_, err := inst.Backup(ctx, "schedule", "", report)
			if err == nil {
				sched.Done(inst.Manifest.ID)
			}
			return err
		})
	})
	go sched.Run(ctx)
	go sampler.Run(ctx)

	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           api.NewRouter(api.Deps{Config: cfg, Manager: mgr, Verifier: verifier, Catalog: reg, Tasks: tm, Java: jm, Metrics: sampler, Store: st, Skins: sk, WS: hub, Version: version, StartedAt: time.Now().UTC()}),
		ReadHeaderTimeout: 10 * time.Second,
	}

	srv.TLSConfig = tlsCfg
	// ACME: a plain listener answers challenges and redirects everything else to HTTPS.
	var acmeSrv *http.Server
	if acmeHTTP != nil && cfg.TLS.HTTPAddr != "" {
		acmeSrv = &http.Server{Addr: cfg.TLS.HTTPAddr, Handler: acmeHTTP, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}
		go func() {
			if err := acmeSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				slog.Error("acme http listener", "addr", cfg.TLS.HTTPAddr, "err", err)
				stop()
			}
		}()
	}
	go func() {
		scheme := "http"
		if tlsCfg != nil {
			scheme = "https"
		}
		slog.Info("wardend listening", "addr", cfg.Listen, "scheme", scheme, "tls", cfg.TLS.Mode, "version", version, "data", cfg.DataDir)
		var err error
		if tlsCfg != nil {
			err = srv.ListenAndServeTLS("", "") // certificates come from TLSConfig
		} else {
			err = srv.ListenAndServe()
		}
		if err != nil && err != http.ErrServerClosed {
			slog.Error("http", "err", err)
			stop()
		}
	}()

	mgr.AutostartAll(ctx)

	<-ctx.Done()
	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	mgr.StopAll(shutdownCtx) // staged stop (stop → SIGTERM → SIGKILL) for every instance
	_ = srv.Shutdown(shutdownCtx)
	if acmeSrv != nil {
		_ = acmeSrv.Shutdown(shutdownCtx)
	}
}
