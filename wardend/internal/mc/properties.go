package mc

import (
	"bufio"
	"os"
	"sort"
	"strings"
)

// ReadProperties parses a Java .properties file (server.properties) into a map. Comments are dropped.
func ReadProperties(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]string{}, nil
		}
		return nil, err
	}
	defer f.Close()
	out := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "!") {
			continue
		}
		k, v, _ := strings.Cut(line, "=")
		out[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	return out, sc.Err()
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
			lines[i] = k + "=" + v
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
		lines = append(lines, k+"="+updates[k])
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(strings.Join(lines, "\n")+"\n"), 0o640); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
