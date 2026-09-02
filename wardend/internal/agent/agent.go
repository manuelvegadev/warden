// Package agent embeds the Warden Agent plugin jar (built from agent/ by `make agent`) so wardend can
// install it into an instance without a network fetch (ADR-018).
package agent

import (
	"archive/zip"
	"bytes"
	"embed"
	"errors"
	"io"
	"regexp"
	"sync"
)

//go:embed dist
var dist embed.FS

// FileName is the jar name inside server/plugins.
const FileName = "WardenAgent.jar"

// ErrNotBuilt means the daemon was built without the agent (make agent was not run).
var ErrNotBuilt = errors.New("the Warden Agent jar is not bundled in this wardend build")

var (
	once    sync.Once
	jarData []byte
	jarVer  string
	jarErr  error
)

var versionRe = regexp.MustCompile(`(?m)^version:\s*['"]?([^'"\s]+)`)

// Jar returns the embedded plugin and its version (from plugin.yml).
func Jar() (data []byte, version string, err error) {
	once.Do(func() {
		jarData, jarErr = dist.ReadFile("dist/" + FileName)
		if jarErr != nil {
			jarErr = ErrNotBuilt
			return
		}
		jarVer, jarErr = readVersion(jarData)
	})
	return jarData, jarVer, jarErr
}

func readVersion(data []byte) (string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}
	for _, f := range zr.File {
		if f.Name != "plugin.yml" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return "", err
		}
		b, err := io.ReadAll(io.LimitReader(rc, 64<<10))
		rc.Close()
		if err != nil {
			return "", err
		}
		if m := versionRe.FindSubmatch(b); m != nil {
			return string(m[1]), nil
		}
		return "", errors.New("plugin.yml without a version")
	}
	return "", errors.New("jar without plugin.yml")
}
