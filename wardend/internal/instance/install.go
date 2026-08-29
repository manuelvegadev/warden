package instance

import (
	"context"
	"fmt"
	"path/filepath"
	"strconv"

	"github.com/manuelvega/warden/wardend/internal/catalog"
	"github.com/manuelvega/warden/wardend/internal/mc"
	"github.com/manuelvega/warden/wardend/internal/tasks"
)

// InstallOptions are the one-off inputs for the install task.
type InstallOptions struct {
	AcceptEULA bool
	Properties map[string]string
}

// Install downloads the server jar (verifying its hash), writes eula.txt and server.properties.
// Meant to run inside a tasks.Manager task.
func (i *Instance) Install(ctx context.Context, reg *catalog.Registry, opts InstallOptions, report tasks.Reporter) error {
	m := i.Manifest
	i.setState(StateInstalling)
	prov, err := reg.Provider(m.Software)
	if err != nil {
		return err
	}
	report(2, "Resolving builds for "+m.MCVersion)
	builds, err := prov.Builds(ctx, m.MCVersion)
	if err != nil {
		return err
	}
	var build catalog.Build
	found := false
	if m.Build == 0 {
		build, found = catalog.LatestBuild(builds)
	} else {
		for _, b := range builds {
			if b.ID == m.Build {
				build, found = b, true
				break
			}
		}
	}
	if !found {
		return fmt.Errorf("no build %d for %s %s", m.Build, m.Software, m.MCVersion)
	}
	m.Build = build.ID

	report(5, "Downloading "+build.Name)
	dest := filepath.Join(i.ServerDir(), build.Name)
	err = reg.Download(ctx, build.URL, build.SHA256, dest, func(done, total int64) {
		if total > 0 {
			report(5+int(done*85/total), fmt.Sprintf("Downloading %s (%d/%d MB)", build.Name, done>>20, total>>20))
		}
	})
	if err != nil {
		return err
	}
	m.Jar = build.Name

	if i.java != nil && m.JavaPath == "" {
		report(90, "Checking Java runtime")
		if _, err := i.java.ResolveJava(ctx, m, true, func(p int, msg string) { report(90+p/20, msg) }); err != nil {
			return fmt.Errorf("java runtime: %w", err)
		}
	}
	report(96, "Writing configuration")
	if err := i.AcceptEULA(opts.AcceptEULA); err != nil {
		return err
	}
	props := map[string]string{
		"server-port": strconv.Itoa(m.Port),
		"query.port":  strconv.Itoa(m.Port),
		// RCON stays disabled: the vanilla server cannot bind it to loopback only. Console goes through stdin.
		"enable-rcon": "false",
		"rcon.port":   strconv.Itoa(m.RconPort),
	}
	for k, v := range opts.Properties {
		props[k] = v
	}
	if err := mc.WriteProperties(filepath.Join(i.ServerDir(), "server.properties"), props); err != nil {
		return err
	}
	if err := i.SaveManifest(); err != nil {
		return err
	}
	i.setState(StateStopped)
	report(100, "Installed "+build.Name)
	return nil
}
