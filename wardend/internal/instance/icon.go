package instance

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"

	"github.com/manuelvega/warden/wardend/internal/mc"
)

// server-icon.png sits next to server.properties and is the only image vanilla loads. It must be
// exactly 64x64 PNG: anything else is refused at boot with a log line nobody reads, so the panel
// refuses it here instead. The client caches the icon in its status response, which means a new
// one shows up after the next restart.

// IconSize is the only dimension the server accepts, in pixels.
const IconSize = 64

// MaxIconBytes caps an upload. A 64x64 PNG is a few KB; this only stops a hostile body.
const MaxIconBytes = 1 << 20

var (
	ErrNoIcon      = errors.New("instance has no server icon")
	ErrIconInvalid = errors.New("server icon must be a 64x64 PNG")
)

func (i *Instance) iconPath() string { return filepath.Join(i.ServerDir(), "server-icon.png") }

// ServerIcon returns the raw PNG, or ErrNoIcon when the instance has none.
func (i *Instance) ServerIcon() ([]byte, error) {
	b, err := os.ReadFile(i.iconPath())
	if os.IsNotExist(err) {
		return nil, ErrNoIcon
	}
	return b, err
}

// SetServerIcon validates and stores the icon. The panel crops and resamples in the browser, but
// the bytes are re-decoded here: the client is a convenience, never the check.
func (i *Instance) SetServerIcon(data []byte) error {
	if len(data) == 0 {
		return fmt.Errorf("%w: empty upload", ErrIconInvalid)
	}
	if len(data) > MaxIconBytes {
		return fmt.Errorf("%w: %d bytes exceeds %d", ErrIconInvalid, len(data), MaxIconBytes)
	}
	cfg, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		if errors.Is(err, image.ErrFormat) {
			return fmt.Errorf("%w: not a PNG", ErrIconInvalid)
		}
		return fmt.Errorf("%w: %s", ErrIconInvalid, err)
	}
	if cfg.Width != IconSize || cfg.Height != IconSize {
		return fmt.Errorf("%w: image is %dx%d", ErrIconInvalid, cfg.Width, cfg.Height)
	}
	if err := os.MkdirAll(i.ServerDir(), 0o750); err != nil {
		return err
	}
	return mc.WriteAtomic(i.iconPath(), data)
}

// RemoveServerIcon deletes the icon; the client falls back to its own placeholder. Removing an
// icon that is not there is not an error.
func (i *Instance) RemoveServerIcon() error {
	err := os.Remove(i.iconPath())
	if os.IsNotExist(err) {
		return nil
	}
	return err
}
