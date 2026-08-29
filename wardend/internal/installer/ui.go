package installer

import (
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"golang.org/x/term"
)

// Minimal terminal chrome for the installer: a spinner per step, a progress bar for waits and a
// few styles. Falls back to plain lines when stdout is not a terminal (CI, logs).

var (
	accent = lipgloss.Color("#7dd3fc")
	dim    = lipgloss.Color("#9ca3af")

	styleTitle  = lipgloss.NewStyle().Bold(true).Foreground(accent)
	styleAccent = lipgloss.NewStyle().Foreground(accent)
	styleOK     = lipgloss.NewStyle().Foreground(lipgloss.Color("#34d399"))
	styleErr    = lipgloss.NewStyle().Foreground(lipgloss.Color("#f87171")).Bold(true)
	styleDim    = lipgloss.NewStyle().Foreground(dim)
	styleBox    = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(accent).Padding(0, 2)
	styleKey    = lipgloss.NewStyle().Foreground(dim).Width(24)
	styleValue  = lipgloss.NewStyle().Bold(true)

	frames = func() []string {
		out := make([]string, 0, 10)
		for _, f := range []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"} {
			out = append(out, styleAccent.Render(f))
		}
		return out
	}()
)

// UI writes to out; interactive decides whether to animate.
type UI struct {
	out         io.Writer
	interactive bool
}

func NewUI(out *os.File) *UI {
	return &UI{out: out, interactive: term.IsTerminal(int(out.Fd()))}
}

func (u *UI) Title(s string)   { fmt.Fprintln(u.out, styleTitle.Render(s)) }
func (u *UI) Dim(s string)     { fmt.Fprintln(u.out, styleDim.Render(s)) }
func (u *UI) Blank()           { fmt.Fprintln(u.out) }
func (u *UI) Success(s string) { fmt.Fprintln(u.out, styleOK.Render("✓ ")+s) }
func (u *UI) Failure(s string) { fmt.Fprintln(u.out, styleErr.Render("✗ ")+s) }
func (u *UI) Box(lines []string) {
	fmt.Fprintln(u.out, styleBox.Render(strings.Join(lines, "\n")))
}

// KV renders an aligned "key   value" line for summaries.
func KV(k, v string) string { return styleKey.Render(k) + styleValue.Render(v) }

// finish clears the animated line (when there was one) and prints the outcome of label.
func (u *UI) finish(label string, err error) error {
	if u.interactive {
		fmt.Fprint(u.out, "\r\033[2K")
	}
	if err != nil {
		u.Failure(label + ": " + err.Error())
	} else {
		u.Success(label)
	}
	return err
}

// Step is one named unit of work: a spinner while it runs, then its result line.
type Step struct {
	Label string
	Run   func() error
}

// Steps runs steps in order, stopping at the first failure.
func (u *UI) Steps(steps []Step) error {
	for _, s := range steps {
		if err := u.Step(s.Label, s.Run); err != nil {
			return err
		}
	}
	return nil
}

// Step runs fn behind a spinner titled label; the result line replaces the spinner.
func (u *UI) Step(label string, fn func() error) error {
	if !u.interactive {
		fmt.Fprintf(u.out, "… %s\n", label)
		return u.finish(label, fn())
	}
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		t := time.NewTicker(80 * time.Millisecond)
		defer t.Stop()
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			case <-t.C:
				fmt.Fprintf(u.out, "\r%s %s", frames[i%len(frames)], label)
			}
		}
	}()
	err := fn()
	close(stop)
	<-done
	return u.finish(label, err)
}

// Progress renders a bar while poll returns false, up to timeout; the label shows the elapsed time.
func (u *UI) Progress(label string, timeout time.Duration, poll func() (done bool, status string)) error {
	start := time.Now()
	const width = 28
	for {
		done, status := poll()
		elapsed := time.Since(start).Round(time.Second)
		if done {
			return u.finish(fmt.Sprintf("%s (%s)", label, elapsed), nil)
		}
		if elapsed > timeout {
			return u.finish(label, fmt.Errorf("timed out after %s (%s)", timeout, status))
		}
		if u.interactive {
			filled := int(float64(width) * float64(elapsed) / float64(timeout))
			bar := styleAccent.Render(strings.Repeat("━", filled)) + styleDim.Render(strings.Repeat("━", width-filled))
			fmt.Fprintf(u.out, "\r%s %s %s %s", bar, label, styleDim.Render(elapsed.String()), styleDim.Render(status))
		}
		time.Sleep(500 * time.Millisecond)
	}
}
