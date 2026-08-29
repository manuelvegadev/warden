package skins

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestFace(t *testing.T) {
	skin := image.NewNRGBA(image.Rect(0, 0, 64, 64))
	for y := 8; y < 16; y++ {
		for x := 8; x < 16; x++ {
			skin.Set(x, y, color.NRGBA{200, 100, 50, 255})
		}
	}
	skin.Set(40, 8, color.NRGBA{0, 0, 255, 255}) // hat pixel over (0,0)
	var buf bytes.Buffer
	png.Encode(&buf, skin)
	out, err := RenderFace(buf.Bytes(), 16)
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(out))
	if err != nil || img.Bounds().Dx() != 16 {
		t.Fatalf("bad output: %v %v", err, img.Bounds())
	}
	r, g, b, _ := img.At(0, 0).RGBA()
	if r != 0 || g != 0 || b>>8 != 255 {
		t.Fatalf("hat layer not composited: %v %v %v", r, g, b)
	}
	r, _, _, _ = img.At(15, 15).RGBA()
	if r>>8 != 200 {
		t.Fatalf("face pixel wrong: %v", r>>8)
	}

	// Legacy skin: an all-black opaque hat layer must not blank the face.
	for y := 8; y < 16; y++ {
		for x := 40; x < 48; x++ {
			skin.Set(x, y, color.NRGBA{0, 0, 0, 255})
		}
	}
	buf.Reset()
	png.Encode(&buf, skin)
	out, _ = RenderFace(buf.Bytes(), 8)
	img, _ = png.Decode(bytes.NewReader(out))
	if r, _, _, _ := img.At(0, 0).RGBA(); r>>8 != 200 {
		t.Fatalf("legacy black hat was composited: %v", r>>8)
	}
}
