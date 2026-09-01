package mc

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// Java .properties escaping. The vanilla server writes `level-type=minecraft\:normal`, and
// Properties.load decodes `\uXXXX` on every version whatever charset the file is read as — which
// is why the section sign goes out as an escape rather than a raw byte.

// UnescapeValue decodes a raw .properties value.
func UnescapeValue(v string) string {
	if !strings.Contains(v, `\`) {
		return v
	}
	var b strings.Builder
	b.Grow(len(v))
	for i := 0; i < len(v); i++ {
		if v[i] != '\\' || i+1 >= len(v) {
			b.WriteByte(v[i])
			continue
		}
		i++
		switch v[i] {
		case 'n':
			b.WriteByte('\n')
		case 'r':
			b.WriteByte('\r')
		case 't':
			b.WriteByte('\t')
		case 'f':
			b.WriteByte('\f')
		case 'u':
			r, width, ok := unicodeEscape(v[i:])
			if !ok {
				b.WriteByte('u') // not a valid escape: keep the letter
				continue
			}
			b.WriteRune(r)
			i += width - 1
		default:
			b.WriteByte(v[i]) // \: \= \# \! \\ and anything else drops the backslash
		}
	}
	return b.String()
}

// unicodeEscape decodes a `\uXXXX` at the start of s, joining a surrogate pair when one follows.
// width counts the characters consumed from s.
func unicodeEscape(s string) (r rune, width int, ok bool) {
	if len(s) < 5 || s[0] != 'u' {
		return 0, 0, false
	}
	n, err := strconv.ParseUint(s[1:5], 16, 32)
	if err != nil {
		return 0, 0, false
	}
	r, width = rune(n), 5
	if utf16.IsSurrogate(r) && len(s) >= 11 && s[5] == '\\' && s[6] == 'u' {
		if lo, err := strconv.ParseUint(s[7:11], 16, 32); err == nil {
			if joined := utf16.DecodeRune(r, rune(lo)); joined != utf8.RuneError {
				return joined, 11, true
			}
		}
	}
	return r, width, true
}

// escapeValue encodes a value for a .properties line.
func escapeValue(v string) string {
	var b strings.Builder
	b.Grow(len(v) + 8)
	for _, r := range v {
		switch r {
		case '\\':
			b.WriteString(`\\`)
		case ':':
			b.WriteString(`\:`)
		case '=':
			b.WriteString(`\=`)
		case '#':
			b.WriteString(`\#`)
		case '!':
			b.WriteString(`\!`)
		case '\n':
			// A raw newline would split the entry and quietly corrupt every key after it.
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		case SectionSign:
			b.WriteString(`\u00A7`)
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// SectionSign introduces a Minecraft colour code (motd, and any other formatted value).
const SectionSign = '\u00a7'

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
