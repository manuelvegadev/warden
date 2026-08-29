package instance

import (
	"bufio"
	"compress/gzip"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var logNameRe = regexp.MustCompile(`^[A-Za-z0-9._-]+\.log(\.gz)?$`)

var ErrBadLogName = errors.New("invalid log file name")

// LogFile describes one file under server/logs.
type LogFile struct {
	Name    string    `json:"name"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime"`
}

func (i *Instance) logsDir() string { return filepath.Join(i.ServerDir(), "logs") }

// LogFiles lists server/logs, newest first (latest.log always first).
func (i *Instance) LogFiles() ([]LogFile, error) {
	entries, err := os.ReadDir(i.logsDir())
	if err != nil {
		if os.IsNotExist(err) {
			return []LogFile{}, nil
		}
		return nil, err
	}
	out := []LogFile{}
	for _, e := range entries {
		if e.IsDir() || !logNameRe.MatchString(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, LogFile{Name: e.Name(), Size: info.Size(), ModTime: info.ModTime().UTC()})
	}
	sort.Slice(out, func(a, b int) bool {
		if out[a].Name == "latest.log" {
			return true
		}
		if out[b].Name == "latest.log" {
			return false
		}
		return out[a].ModTime.After(out[b].ModTime)
	})
	return out, nil
}

// OpenLog returns a reader for a log file (gunzipped on the fly) confined to server/logs.
func (i *Instance) OpenLog(name string) (io.ReadCloser, error) {
	if !logNameRe.MatchString(name) {
		return nil, ErrBadLogName
	}
	f, err := os.Open(filepath.Join(i.logsDir(), name))
	if err != nil {
		return nil, err
	}
	if !strings.HasSuffix(name, ".gz") {
		return f, nil
	}
	gz, err := gzip.NewReader(f)
	if err != nil {
		f.Close()
		return nil, err
	}
	return struct {
		io.Reader
		io.Closer
	}{gz, f}, nil
}

// TailLog returns the last n lines of a log file.
func (i *Instance) TailLog(name string, n int) ([]string, error) {
	r, err := i.OpenLog(name)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	ring := make([]string, 0, n)
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for sc.Scan() {
		if len(ring) == n {
			ring = ring[1:]
		}
		ring = append(ring, sc.Text())
	}
	return ring, sc.Err()
}

// History returns the last n console lines; when the in-memory buffer is empty (e.g. after a daemon
// restart) it falls back to the tail of logs/latest.log so the UI never opens on a blank console.
func (i *Instance) History(n int) []Line {
	if lines := i.Console.Last(n); len(lines) > 0 {
		return lines
	}
	raw, err := i.TailLog("latest.log", n)
	if err != nil {
		return []Line{}
	}
	out := make([]Line, 0, len(raw))
	for _, t := range raw {
		out = append(out, Line{Level: levelOf(t), Text: t})
	}
	return out
}
