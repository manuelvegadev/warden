package mc

import (
	"archive/zip"
	"bufio"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Archives in the file manager (ADR-020): a zip's listing and one entry out of it (datapacks,
// resource packs, jars), and what a jar is — the plugin or mod its descriptor names, the manifest,
// the Java it needs.

// ArchiveEntry is one file of a zip.
type ArchiveEntry struct {
	Name       string    `json:"name"`
	Size       uint64    `json:"size"`
	Compressed uint64    `json:"compressed"`
	Modified   time.Time `json:"modified"`
}

// ArchiveListing is a zip's files, sorted by name; Total counts them all when only the first
// `limit` are listed.
type ArchiveListing struct {
	Entries []ArchiveEntry `json:"entries"`
	Total   int            `json:"total"`
}

// MaxArchiveEntry caps what reading one entry of an archive returns: a zip bomb is small on disk.
const MaxArchiveEntry = 32 << 20

// ListArchive lists a zip's files (not its directories), at most `limit` of them.
func ListArchive(name string, limit int) (ArchiveListing, error) {
	zr, err := zip.OpenReader(name)
	if err != nil {
		return ArchiveListing{}, err
	}
	defer zr.Close()
	var out ArchiveListing
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		out.Total++
		out.Entries = append(out.Entries, ArchiveEntry{Name: f.Name, Size: f.UncompressedSize64,
			Compressed: f.CompressedSize64, Modified: f.Modified})
	}
	sort.Slice(out.Entries, func(i, j int) bool { return out.Entries[i].Name < out.Entries[j].Name })
	if len(out.Entries) > limit {
		out.Entries = out.Entries[:limit]
	}
	return out, nil
}

// ReadArchiveEntry returns one entry of a zip, up to MaxArchiveEntry bytes; `truncated` says it
// holds more.
func ReadArchiveEntry(name, entry string) (data []byte, truncated bool, err error) {
	zr, err := zip.OpenReader(name)
	if err != nil {
		return nil, false, err
	}
	defer zr.Close()
	for _, f := range zr.File {
		if f.Name != entry {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, false, err
		}
		defer rc.Close()
		data, err = io.ReadAll(io.LimitReader(rc, MaxArchiveEntry+1))
		if len(data) > MaxArchiveEntry {
			return data[:MaxArchiveEntry], true, err
		}
		return data, false, err
	}
	return nil, false, fmt.Errorf("%w: %s", ErrNoSuchEntry, entry)
}

// ErrNoSuchEntry is an archive entry that is not there.
var ErrNoSuchEntry = fmt.Errorf("no such entry in the archive")

// JarInfo is what a jar is, read from inside it.
type JarInfo struct {
	// Kind: paper-plugin, bukkit-plugin, velocity-plugin, bungee-plugin, fabric-mod, quilt-mod,
	// neoforge-mod, forge-mod, or library when no descriptor is found.
	Kind string `json:"kind"`
	// Descriptor is the entry it was read from; Meta its content parsed (YAML or JSON), Raw its text
	// (TOML is shown as text: there is no TOML parser here).
	Descriptor string            `json:"descriptor,omitempty"`
	Meta       any               `json:"meta,omitempty"`
	Raw        string            `json:"raw,omitempty"`
	Manifest   map[string]string `json:"manifest,omitempty"`
	// JavaMin is the Java version its classes were compiled for (from a class file's major version).
	JavaMin int `json:"javaMin,omitempty"`
	Entries int `json:"entries"`
}

// The descriptors a jar is recognised by, in order: Paper prefers paper-plugin.yml to plugin.yml.
var jarDescriptors = []struct{ entry, kind, format string }{
	{"paper-plugin.yml", "paper-plugin", "yaml"},
	{"plugin.yml", "bukkit-plugin", "yaml"},
	{"velocity-plugin.json", "velocity-plugin", "json"},
	{"bungee.yml", "bungee-plugin", "yaml"},
	{"fabric.mod.json", "fabric-mod", "json"},
	{"quilt.mod.json", "quilt-mod", "json"},
	{"META-INF/neoforge.mods.toml", "neoforge-mod", "toml"},
	{"META-INF/mods.toml", "forge-mod", "toml"},
}

const maxDescriptor = 256 << 10

// ReadJarInfo reads a jar's descriptor, manifest and class version.
func ReadJarInfo(name string) (JarInfo, error) {
	zr, err := zip.OpenReader(name)
	if err != nil {
		return JarInfo{}, err
	}
	defer zr.Close()
	byName := map[string]*zip.File{}
	var firstClass *zip.File
	info := JarInfo{Kind: "library"}
	for _, f := range zr.File {
		byName[f.Name] = f
		if !f.FileInfo().IsDir() {
			info.Entries++
		}
		// Multi-release jars keep newer classes under META-INF/versions; the base ones say the minimum.
		if firstClass == nil && path.Ext(f.Name) == ".class" && !strings.HasPrefix(f.Name, "META-INF/") {
			firstClass = f
		}
	}
	for _, d := range jarDescriptors {
		f, ok := byName[d.entry]
		if !ok {
			continue
		}
		text, err := readEntry(f, maxDescriptor)
		if err != nil {
			return info, err
		}
		info.Kind, info.Descriptor, info.Raw = d.kind, d.entry, string(text)
		switch d.format {
		case "yaml":
			var doc yaml.Node
			if yaml.Unmarshal(text, &doc) == nil && len(doc.Content) > 0 {
				info.Meta = yamlValue(doc.Content[0])
			}
		case "json":
			var v any
			if json.Unmarshal(text, &v) == nil {
				info.Meta = v
			}
		}
		break
	}
	if f, ok := byName["META-INF/MANIFEST.MF"]; ok {
		if text, err := readEntry(f, 64<<10); err == nil {
			info.Manifest = parseManifest(string(text))
		}
	}
	if firstClass != nil {
		if head, err := readEntry(firstClass, 8); err == nil && len(head) == 8 && binary.BigEndian.Uint32(head) == 0xCAFEBABE {
			// Class file major version 52 is Java 8, 61 Java 17, 65 Java 21: Java = major − 44.
			info.JavaMin = int(binary.BigEndian.Uint16(head[6:])) - 44
		}
	}
	return info, nil
}

func readEntry(f *zip.File, limit int64) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(io.LimitReader(rc, limit))
}

// parseManifest reads META-INF/MANIFEST.MF's main section: "Key: value" lines, a line starting
// with a space continuing the one before it.
func parseManifest(text string) map[string]string {
	out := map[string]string{}
	var last string
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		line := strings.TrimRight(sc.Text(), "\r")
		if line == "" {
			break // the main section ends at the first blank line
		}
		if line[0] == ' ' && last != "" {
			out[last] += line[1:]
			continue
		}
		if k, v, ok := strings.Cut(line, ":"); ok {
			last = strings.TrimSpace(k)
			out[last] = strings.TrimSpace(v)
		}
	}
	return out
}

// yamlValue turns a YAML node into what JSON encodes, keeping each scalar as it is written: a
// descriptor's `version: 2.0` or `1.10` is a version, not the number 2 or 1.1. Booleans and nulls
// are the only scalars converted.
func yamlValue(n *yaml.Node) any {
	switch n.Kind {
	case yaml.DocumentNode:
		if len(n.Content) > 0 {
			return yamlValue(n.Content[0])
		}
	case yaml.AliasNode:
		return yamlValue(n.Alias)
	case yaml.MappingNode:
		out := make(map[string]any, len(n.Content)/2)
		for i := 0; i+1 < len(n.Content); i += 2 {
			out[n.Content[i].Value] = yamlValue(n.Content[i+1])
		}
		return out
	case yaml.SequenceNode:
		out := make([]any, 0, len(n.Content))
		for _, c := range n.Content {
			out = append(out, yamlValue(c))
		}
		return out
	case yaml.ScalarNode:
		switch n.ShortTag() {
		case "!!bool":
			var b bool
			if n.Decode(&b) == nil {
				return b
			}
		case "!!null":
			return nil
		}
		return n.Value
	}
	return nil
}
