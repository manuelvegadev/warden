package instance

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func pngOf(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.NRGBA{R: 90, G: 160, B: 70, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestServerIconRoundTrip(t *testing.T) {
	i := newFilesInstance(t)

	if _, err := i.ServerIcon(); !errors.Is(err, ErrNoIcon) {
		t.Fatalf("ServerIcon on a fresh instance = %v, want ErrNoIcon", err)
	}

	want := pngOf(t, IconSize, IconSize)
	if err := i.SetServerIcon(want); err != nil {
		t.Fatal(err)
	}
	got, err := i.ServerIcon()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("icon changed on the way through: %d bytes in, %d out", len(want), len(got))
	}

	if err := i.RemoveServerIcon(); err != nil {
		t.Fatal(err)
	}
	if _, err := i.ServerIcon(); !errors.Is(err, ErrNoIcon) {
		t.Errorf("icon survived removal: %v", err)
	}
	if err := i.RemoveServerIcon(); err != nil {
		t.Errorf("removing a missing icon should be a no-op, got %v", err)
	}
}

// The browser crops to 64x64 before uploading; these are the cases where that is not what arrived.
func TestServerIconRejects(t *testing.T) {
	i := newFilesInstance(t)
	for name, data := range map[string][]byte{
		"empty":     {},
		"not a png": []byte("\xff\xd8\xff\xe0 JFIF, actually"),
		"too small": pngOf(t, 32, 32),
		"too big":   pngOf(t, 128, 128),
		"oblong":    pngOf(t, 64, 63),
	} {
		if err := i.SetServerIcon(data); !errors.Is(err, ErrIconInvalid) {
			t.Errorf("SetServerIcon(%s) = %v, want ErrIconInvalid", name, err)
		}
	}
	if _, err := i.ServerIcon(); !errors.Is(err, ErrNoIcon) {
		t.Error("a rejected upload still wrote a file")
	}
}
