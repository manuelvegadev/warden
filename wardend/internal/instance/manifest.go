package instance

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// Manifest is the content of instance.json. See docs/adr/006-multi-instance.md.
type Manifest struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Software      string            `json:"software"`  // paper | purpur | fabric | vanilla
	MCVersion     string            `json:"mcVersion"` // "1.21.8"
	Build         int               `json:"build"`
	Jar           string            `json:"jar"`                   // jar file name inside server/
	JavaRuntime   string            `json:"javaRuntime,omitempty"` // managed runtime id (e.g. "temurin-25"); "" = auto
	JavaPath      string            `json:"javaPath,omitempty"`    // explicit binary; overrides JavaRuntime
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
	Backups       BackupSettings    `json:"backups"`
	Upgrades      []UpgradeRecord   `json:"upgrades,omitempty"` // newest last
	CreatedAt     time.Time         `json:"createdAt"`
}

// UpgradeRecord is one completed server upgrade (see Instance.Upgrade).
type UpgradeRecord struct {
	FromVersion string    `json:"fromVersion"`
	FromBuild   int       `json:"fromBuild"`
	ToVersion   string    `json:"toVersion"`
	ToBuild     int       `json:"toBuild"`
	Backup      string    `json:"backup"` // file name under <instance>/backups
	At          time.Time `json:"at"`
}

type InstalledPlugin struct {
	FileName    string    `json:"fileName"`
	Source      string    `json:"source"` // hangar|modrinth|manual
	ProjectID   string    `json:"projectId,omitempty"`
	Name        string    `json:"name,omitempty"` // project title from the catalog
	VersionID   string    `json:"versionId,omitempty"`
	Version     string    `json:"version,omitempty"`
	HashAlgo    string    `json:"hashAlgo,omitempty"`
	Hash        string    `json:"hash,omitempty"`
	Icon        string    `json:"icon,omitempty"` // file under <instance>/icons, fetched at install time
	InstalledAt time.Time `json:"installedAt"`
}

const manifestFile = "instance.json"

// Normalize fills the zero value with the defaults the panel shows: daily, keep 7, full scope.
func (b *BackupSettings) Normalize() {
	if b.EveryHours <= 0 {
		b.EveryHours = 24
	}
	if b.Keep < 0 {
		b.Keep = 0
	}
	if b.Scope != "worlds" {
		b.Scope = "full"
	}
}

func readManifest(dir string) (*Manifest, error) {
	b, err := os.ReadFile(filepath.Join(dir, manifestFile))
	if err != nil {
		return nil, err
	}
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	m.Backups.Normalize()
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
