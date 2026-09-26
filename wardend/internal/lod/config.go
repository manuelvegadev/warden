package lod

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"sort"
	"strconv"

	"gopkg.in/yaml.v3"
)

// Key is one setting the panel edits: its type and range, its default (the plugin's, for the
// version the schema was written for) and whether it applies on a running server.
type Key struct {
	Name    string   `json:"name"`
	Label   string   `json:"label"`
	Help    string   `json:"help,omitempty"`
	Type    string   `json:"type"` // int | bool | enum
	Default any      `json:"default"`
	Min     *int     `json:"min,omitempty"`
	Max     *int     `json:"max,omitempty"`
	Options []string `json:"options,omitempty"`
	Live    bool     `json:"live"`
}

func ptr(n int) *int { return &n }

// DHS 0.14.0 `config.yml`. Live: re-read by `/dhs reload`; scheduler_threads only at enable.
var dhsKeys = []Key{
	{Name: "render_distance", Label: "LOD distance", Help: "How far LODs reach, in chunks.", Type: "int", Default: 1024, Min: ptr(1), Max: ptr(4096), Live: true},
	{Name: "distant_generation_enabled", Label: "Build LODs for distant chunks", Type: "bool", Default: true, Live: true},
	{Name: "generate_new_chunks", Label: "Generate missing chunks", Help: "Off: LODs only where the world already exists, so it does not grow.", Type: "bool", Default: true, Live: true},
	{Name: "builder_type", Label: "Builder", Help: "FastOverworldBuilder trades detail for speed.", Type: "enum", Default: "FullBuilder", Options: []string{"FullBuilder", "FastOverworldBuilder", "None"}, Live: true},
	{Name: "full_data_request_concurrency_limit", Label: "Requests per player at once", Type: "int", Default: 20, Min: ptr(1), Max: ptr(1000), Live: true},
	{Name: "real_time_updates_enabled", Label: "Send block changes live", Type: "bool", Default: true, Live: true},
	{Name: "use_vanilla_world_border", Label: "Stop at the world border", Type: "bool", Default: true, Live: true},
	{Name: "scheduler_threads", Label: "Worker threads", Type: "int", Default: 4, Min: ptr(1), Max: ptr(64), Live: false},
}

// VSS/LSS `vss-server-config.json`. Live: `/vsslod set <key> <value>` (it also saves the file).
var lssKeys = []Key{
	{Name: "lodDistanceChunks", Label: "LOD distance", Help: "How far LODs reach, in chunks.", Type: "int", Default: 512, Min: ptr(1), Max: ptr(2048), Live: true},
	{Name: "mbPerSecondLimitPerPlayer", Label: "Bandwidth per player (MB/s)", Type: "int", Default: 25, Min: ptr(1), Max: ptr(1000), Live: true},
	{Name: "mbPerSecondLimitGlobal", Label: "Total bandwidth (MB/s)", Type: "int", Default: 75, Min: ptr(1), Max: ptr(10000), Live: true},
	{Name: "generationConcurrencyLimitGlobal", Label: "Chunks generated at once", Type: "int", Default: 40, Min: ptr(0), Max: ptr(1000), Live: true},
	{Name: "generationConcurrencyLimitPerPlayer", Label: "Chunks generated at once per player", Type: "int", Default: 40, Min: ptr(0), Max: ptr(1000), Live: true},
	{Name: "farPlayers", Label: "Show far players", Type: "enum", Default: "on", Options: []string{"on", "off"}, Live: true},
	{Name: "enabled", Label: "Enabled", Type: "bool", Default: true, Live: false},
	{Name: "enableChunkGeneration", Label: "Generate missing chunks", Help: "Off: LODs only where the world already exists.", Type: "bool", Default: true, Live: false},
	{Name: "lodStore", Label: "Keep LODs on disk", Type: "enum", Default: "on", Options: []string{"on", "off"}, Live: false},
	{Name: "lodStoreMaxMB", Label: "LOD store size cap (MB, 0 = none)", Type: "int", Default: 0, Min: ptr(0), Max: ptr(1 << 20), Live: false},
}

func (p *Provider) key(name string) (Key, bool) {
	i := slices.IndexFunc(p.Keys, func(k Key) bool { return k.Name == name })
	if i < 0 {
		return Key{}, false
	}
	return p.Keys[i], true
}

// Validate checks values against the schema and normalises them (JSON numbers become int).
func (p *Provider) Validate(values map[string]any) (map[string]any, error) {
	out := map[string]any{}
	for name, v := range values {
		k, ok := p.key(name)
		if !ok {
			return nil, fmt.Errorf("%s is not a setting the panel edits", name)
		}
		switch k.Type {
		case "int":
			f, ok := v.(float64)
			if n, isInt := v.(int); isInt {
				f, ok = float64(n), true
			}
			if !ok || f != math.Trunc(f) {
				return nil, fmt.Errorf("%s must be a whole number", name)
			}
			n := int(f)
			if (k.Min != nil && n < *k.Min) || (k.Max != nil && n > *k.Max) {
				switch {
				case k.Min != nil && k.Max != nil:
					return nil, fmt.Errorf("%s must be between %d and %d", name, *k.Min, *k.Max)
				case k.Min != nil:
					return nil, fmt.Errorf("%s must be at least %d", name, *k.Min)
				default:
					return nil, fmt.Errorf("%s must be at most %d", name, *k.Max)
				}
			}
			out[name] = n
		case "bool":
			b, ok := v.(bool)
			if !ok {
				return nil, fmt.Errorf("%s must be true or false", name)
			}
			out[name] = b
		case "enum":
			s, ok := v.(string)
			if !ok || !slices.Contains(k.Options, s) {
				return nil, fmt.Errorf("%s must be one of %v", name, k.Options)
			}
			out[name] = s
		}
	}
	return out, nil
}

// ReadConfig returns every key's value in the file, its default where the file lacks it (or when
// there is no file yet).
func (p *Provider) ReadConfig(raw []byte) (map[string]any, error) {
	found := map[string]any{}
	if len(bytes.TrimSpace(raw)) > 0 {
		var err error
		if p.Format == "yaml" {
			err = yaml.Unmarshal(raw, &found)
		} else {
			err = json.Unmarshal(raw, &found)
		}
		if err != nil {
			return nil, fmt.Errorf("reading the configuration: %w", err)
		}
	}
	out := map[string]any{}
	for _, k := range p.Keys {
		v, ok := found[k.Name]
		if !ok {
			out[k.Name] = k.Default
			continue
		}
		if f, isFloat := v.(float64); isFloat && k.Type == "int" {
			v = int(f)
		}
		out[k.Name] = v
	}
	return out, nil
}

// WriteConfig sets the given (validated) values and keeps everything else in the file: other keys,
// and in YAML the comments. JSON comes back with its keys sorted.
func (p *Provider) WriteConfig(raw []byte, values map[string]any) ([]byte, error) {
	if p.Format == "json" {
		m := map[string]json.RawMessage{}
		if len(bytes.TrimSpace(raw)) > 0 {
			if err := json.Unmarshal(raw, &m); err != nil {
				return nil, fmt.Errorf("reading the configuration: %w", err)
			}
		}
		for k, v := range values {
			b, _ := json.Marshal(v)
			m[k] = b
		}
		return json.MarshalIndent(m, "", "  ")
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("reading the configuration: %w", err)
	}
	if doc.Kind == 0 {
		doc = yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{{Kind: yaml.MappingNode}}}
	}
	root := doc.Content[0]
	if root.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("the configuration is not a mapping")
	}
	names := make([]string, 0, len(values))
	for k := range values {
		names = append(names, k)
	}
	sort.Strings(names)
	for _, name := range names {
		val := scalar(values[name])
		set := false
		for i := 0; i+1 < len(root.Content); i += 2 {
			if root.Content[i].Value == name {
				old := root.Content[i+1]
				val.LineComment, val.HeadComment, val.FootComment = old.LineComment, old.HeadComment, old.FootComment
				root.Content[i+1] = val
				set = true
				break
			}
		}
		if !set {
			root.Content = append(root.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: name}, val)
		}
	}
	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(&doc); err != nil {
		return nil, err
	}
	enc.Close()
	return buf.Bytes(), nil
}

func scalar(v any) *yaml.Node {
	switch x := v.(type) {
	case bool:
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool", Value: strconv.FormatBool(x)}
	case int:
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!int", Value: strconv.Itoa(x)}
	default:
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: fmt.Sprint(x)}
	}
}

// Live is what to run on a running server for the changed keys, and which keys wait for a
// restart. DHS re-reads its whole file with one reload; VSS/LSS set each key.
func (p *Provider) Live(b Brand, changed map[string]any) (commands, restart []string) {
	names := make([]string, 0, len(changed))
	for k := range changed {
		names = append(names, k)
	}
	sort.Strings(names)
	reload := false
	for _, name := range names {
		k, ok := p.key(name)
		if !ok {
			continue
		}
		if !k.Live {
			restart = append(restart, name)
			continue
		}
		if p.Kind == DHS {
			reload = true
		} else {
			commands = append(commands, fmt.Sprintf("%s set %s %v", b.Command, name, changed[name]))
		}
	}
	if reload {
		commands = append(commands, b.Command+" reload")
	}
	return commands, restart
}
