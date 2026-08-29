package mc

import (
	"archive/zip"
	"bufio"
	"io"
	"strings"
)

// PluginMeta is the subset of plugin.yml / paper-plugin.yml the panel shows.
type PluginMeta struct {
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Description string   `json:"description,omitempty"`
	Authors     []string `json:"authors,omitempty"`
	APIVersion  string   `json:"apiVersion,omitempty"`
}

// ReadPluginMeta opens a plugin jar and parses its descriptor. Bukkit's plugin.yml is
// consulted first, then Paper's paper-plugin.yml. Missing descriptor → ok=false.
func ReadPluginMeta(jarPath string) (meta PluginMeta, ok bool, err error) {
	zr, err := zip.OpenReader(jarPath)
	if err != nil {
		return meta, false, err
	}
	defer zr.Close()
	var descriptor *zip.File
	for _, f := range zr.File {
		if f.Name == "plugin.yml" {
			descriptor = f
			break
		}
		if f.Name == "paper-plugin.yml" && descriptor == nil {
			descriptor = f
		}
	}
	if descriptor == nil {
		return meta, false, nil
	}
	rc, err := descriptor.Open()
	if err != nil {
		return meta, false, err
	}
	defer rc.Close()
	meta = parsePluginYAML(io.LimitReader(rc, 256<<10))
	return meta, meta.Name != "", nil
}

// parsePluginYAML reads the top-level scalar keys we care about. Plugin descriptors are flat,
// hand-written YAML; a full parser would be a new dependency for `name: X` and `version: Y`.
func parsePluginYAML(r io.Reader) PluginMeta {
	var m PluginMeta
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 256<<10)
	for sc.Scan() {
		line := sc.Text()
		if line == "" || line[0] == ' ' || line[0] == '\t' || line[0] == '#' {
			continue // nested or comment
		}
		key, val, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		val = yamlScalar(val)
		switch strings.TrimSpace(key) {
		case "name":
			m.Name = val
		case "version":
			m.Version = val
		case "description":
			m.Description = val
		case "api-version":
			m.APIVersion = val
		case "author":
			if val != "" {
				m.Authors = append(m.Authors, val)
			}
		case "authors":
			m.Authors = append(m.Authors, yamlFlowList(val)...)
		}
	}
	return m
}

// yamlScalar trims a scalar value, its quotes and a trailing comment.
func yamlScalar(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if v[0] == '"' || v[0] == '\'' {
		if end := strings.LastIndexByte(v[1:], v[0]); end >= 0 {
			return v[1 : end+1]
		}
		return v[1:]
	}
	if i := strings.Index(v, " #"); i >= 0 {
		v = strings.TrimSpace(v[:i])
	}
	return v
}

// yamlFlowList parses `[a, "b", c]`; block lists (indented "- x") are skipped by the caller.
func yamlFlowList(v string) []string {
	v = strings.TrimSpace(v)
	if !strings.HasPrefix(v, "[") {
		return nil
	}
	v = strings.TrimSuffix(strings.TrimPrefix(v, "["), "]")
	var out []string
	for _, item := range strings.Split(v, ",") {
		if s := yamlScalar(item); s != "" {
			out = append(out, s)
		}
	}
	return out
}
