package mc

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Property is a server.properties entry as exposed by the API: schema (when known) + current value.
type Property struct {
	PropertySpec
	Value string `json:"value"`
	Known bool   `json:"known"`
}

// ListProperties merges the schema with the file contents. Unknown keys are appended as strings.
func ListProperties(path string) ([]Property, error) {
	vals, err := ReadProperties(path)
	if err != nil {
		return nil, err
	}
	out := make([]Property, 0, len(PropertySchema)+8)
	seen := map[string]bool{}
	for _, spec := range PropertySchema {
		v, ok := vals[spec.Key]
		if !ok {
			v = spec.Default
		}
		out = append(out, Property{PropertySpec: spec, Value: v, Known: true})
		seen[spec.Key] = true
	}
	var extra []string
	for k := range vals {
		if !seen[k] {
			extra = append(extra, k)
		}
	}
	sort.Strings(extra)
	for _, k := range extra {
		out = append(out, Property{PropertySpec: PropertySpec{Key: k, Type: "string", Group: "Other", RequiresRestart: true}, Value: vals[k]})
	}
	return out, nil
}

// ValidateProperty checks a value against the schema. Unknown keys are accepted as-is.
func ValidateProperty(key, value string) error {
	spec := SpecFor(key)
	if spec == nil {
		return nil
	}
	if spec.Managed {
		return fmt.Errorf("%s is managed by wardend", key)
	}
	switch spec.Type {
	case "bool":
		if value != "true" && value != "false" {
			return fmt.Errorf("%s must be true or false", key)
		}
	case "int":
		n, err := strconv.Atoi(value)
		if err != nil {
			return fmt.Errorf("%s must be an integer", key)
		}
		if spec.Min != nil && n < *spec.Min {
			return fmt.Errorf("%s must be >= %d", key, *spec.Min)
		}
		if spec.Max != nil && n > *spec.Max {
			return fmt.Errorf("%s must be <= %d", key, *spec.Max)
		}
	case "enum":
		ok := false
		for _, e := range spec.Enum {
			if e == value {
				ok = true
				break
			}
		}
		if !ok {
			return fmt.Errorf("%s must be one of %v", key, spec.Enum)
		}
	}
	return nil
}

// RequiresRestart reports whether changing key needs a server restart to take effect.
// Keys with a LiveCommand never do; unknown keys are assumed to.
func RequiresRestart(key string) bool {
	spec := SpecFor(key)
	if spec == nil {
		return true
	}
	return spec.LiveCommand == nil && spec.RequiresRestart
}

// ValidateRaw checks a whole .properties text against the schema, reporting the offending line.
func ValidateRaw(text string) error {
	kvs, err := ParseProperties(strings.NewReader(text))
	if err != nil {
		return err
	}
	for _, kv := range kvs {
		if err := ValidateProperty(kv.Key, kv.Value); err != nil {
			return fmt.Errorf("line %d: %w", kv.Line, err)
		}
	}
	return nil
}
