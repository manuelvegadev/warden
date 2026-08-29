package instance

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// Manifest es el contenido de instance.json. Ver docs/adr/006-multi-instancia.md.
type Manifest struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Software      string            `json:"software"`  // "paper"
	MCVersion     string            `json:"mcVersion"` // "1.21.8"
	Build         int               `json:"build"`
	Jar           string            `json:"jar"` // nombre del jar dentro de server/
	JavaPath      string            `json:"javaPath,omitempty"`
	MemoryMB      int               `json:"memoryMb"`
	JVMPreset     string            `json:"jvmFlagsPreset"` // aikar|basic|custom
	JVMFlags      []string          `json:"jvmFlags,omitempty"`
	Port          int               `json:"port"`
	RconPort      int               `json:"rconPort"`
	RconPassword  string            `json:"rconPassword"`
	Autostart     bool              `json:"autostart"`
	RestartPolicy string            `json:"restartPolicy"` // never|on-crash|always
	StopTimeoutS  int               `json:"stopTimeoutSeconds"`
	Plugins       []InstalledPlugin `json:"plugins"`
	CreatedAt     time.Time         `json:"createdAt"`
}

type InstalledPlugin struct {
	FileName  string `json:"fileName"`
	Source    string `json:"source"` // hangar|modrinth|manual
	ProjectID string `json:"projectId,omitempty"`
	VersionID string `json:"versionId,omitempty"`
	Version   string `json:"version,omitempty"`
	HashAlgo  string `json:"hashAlgo,omitempty"`
	Hash      string `json:"hash,omitempty"`
}

const manifestFile = "instance.json"

func readManifest(dir string) (*Manifest, error) {
	b, err := os.ReadFile(filepath.Join(dir, manifestFile))
	if err != nil {
		return nil, err
	}
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func (m *Manifest) save(dir string) error {
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(dir, manifestFile+".tmp")
	if err := os.WriteFile(tmp, b, 0o640); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, manifestFile))
}
