package mc

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
)

// Java .properties escaping: the vanilla server writes `level-type=minecraft\:normal`.
var propUnescaper = strings.NewReplacer(`\:`, ":", `\=`, "=", `\#`, "#", `\!`, "!", `\\`, `\`)
var propEscaper = strings.NewReplacer(`\`, `\\`, ":", `\:`, "=", `\=`, "#", `\#`, "!", `\!`)

// UnescapeValue decodes a raw .properties value.
func UnescapeValue(v string) string { return propUnescaper.Replace(v) }

func escapeValue(v string) string { return propEscaper.Replace(v) }

// KeyValue is one parsed `key=value` line.
type KeyValue struct {
	Line  int // 1-based
	Key   string
	Value string // unescaped
}

// ParseProperties parses .properties text; comments (# or !) and blank lines are skipped.
// A non-comment line without '=' is an error that names the line.
func ParseProperties(r io.Reader) ([]KeyValue, error) {
	var out []KeyValue
	sc := bufio.NewScanner(r)
	for n := 1; sc.Scan(); n++ {
		t := strings.TrimSpace(sc.Text())
		if t == "" || strings.HasPrefix(t, "#") || strings.HasPrefix(t, "!") {
			continue
		}
		k, v, ok := strings.Cut(t, "=")
		if !ok {
			return nil, fmt.Errorf("line %d: expected key=value", n)
		}
		out = append(out, KeyValue{Line: n, Key: strings.TrimSpace(k), Value: UnescapeValue(strings.TrimSpace(v))})
	}
	return out, sc.Err()
}

// ReadProperties loads a .properties file into a map (missing file = empty map).
func ReadProperties(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]string{}, nil
		}
		return nil, err
	}
	defer f.Close()
	kvs, err := ParseProperties(f)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(kvs))
	for _, kv := range kvs {
		out[kv.Key] = kv.Value
	}
	return out, nil
}

// WriteProperties merges updates into the file, preserving existing lines/comments and appending new keys.
func WriteProperties(path string, updates map[string]string) error {
	var lines []string
	if b, err := os.ReadFile(path); err == nil {
		lines = strings.Split(strings.TrimRight(string(b), "\n"), "\n")
	} else if !os.IsNotExist(err) {
		return err
	}
	seen := map[string]bool{}
	for i, line := range lines {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "#") {
			continue
		}
		k, _, _ := strings.Cut(t, "=")
		k = strings.TrimSpace(k)
		if v, ok := updates[k]; ok {
			lines[i] = k + "=" + escapeValue(v)
			seen[k] = true
		}
	}
	var missing []string
	for k := range updates {
		if !seen[k] {
			missing = append(missing, k)
		}
	}
	sort.Strings(missing)
	if len(lines) == 0 {
		lines = append(lines, "#Minecraft server properties", "#Managed by wardend")
	}
	for _, k := range missing {
		lines = append(lines, k+"="+escapeValue(updates[k]))
	}
	return WriteAtomic(path, []byte(strings.Join(lines, "\n")+"\n"))
}

// WriteAtomic writes via a temp file + rename so readers never see a partial file.
func WriteAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o640); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
