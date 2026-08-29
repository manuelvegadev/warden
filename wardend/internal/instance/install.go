package instance

import (
	"context"
	"fmt"
	"path/filepath"
	"slices"
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
	build, err := resolveBuild(ctx, prov, m.Software, m.MCVersion, m.Build)
	if err != nil {
		return err
	}
	m.Build = build.ID
	if err := downloadBuild(ctx, reg, build, filepath.Join(i.ServerDir(), build.Name), report, 5, 90); err != nil {
		return err
	}
	m.Jar = build.Name
	if err := i.ensureJava(ctx, report, 90, 95); err != nil {
		return err
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

// resolveBuild picks build id for software/mcVersion, or the newest when id is 0.
func resolveBuild(ctx context.Context, prov catalog.ServerProvider, software, mcVersion string, id int) (catalog.Build, error) {
	builds, err := prov.Builds(ctx, mcVersion)
	if err != nil {
		return catalog.Build{}, err
	}
	if id == 0 {
		if b, ok := catalog.LatestBuild(builds); ok {
			return b, nil
		}
	} else if idx := slices.IndexFunc(builds, func(b catalog.Build) bool { return b.ID == id }); idx >= 0 {
		return builds[idx], nil
	}
	return catalog.Build{}, fmt.Errorf("no build %d for %s %s", id, software, mcVersion)
}

// downloadBuild fetches a server jar with sha256 verification, mapping progress onto [from,to].
func downloadBuild(ctx context.Context, reg *catalog.Registry, build catalog.Build, dest string, report tasks.Reporter, from, to int) error {
	report(from, "Downloading "+build.Name)
	return reg.Download(ctx, build.URL, catalog.Checksum{Algo: "sha256", Value: build.SHA256}, dest, func(done, total int64) {
		if total > 0 {
			report(from+int(done*int64(to-from)/total), fmt.Sprintf("Downloading %s (%d/%d MB)", build.Name, done>>20, total>>20))
		}
	})
}

// ensureJava resolves (downloading if needed) the runtime for the manifest's Minecraft version.
func (i *Instance) ensureJava(ctx context.Context, report tasks.Reporter, from, to int) error {
	if i.java == nil || i.Manifest.JavaPath != "" {
		return nil
	}
	report(from, "Checking Java runtime")
	if _, err := i.java.ResolveJava(ctx, i.Manifest, true, func(p int, msg string) { report(from+p*(to-from)/100, msg) }); err != nil {
		return fmt.Errorf("java runtime: %w", err)
	}
	return nil
}
