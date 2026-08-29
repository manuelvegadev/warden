// Package skins fetches player skins from Mojang and serves face crops, with an on-disk cache so
// the panel never talks to Mojang from the browser and repeated views are free.
package skins

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/manuelvega/warden/wardend/internal/mojang"
)

// ErrNoSkin means Mojang has no account (or no custom skin) for that name.
var ErrNoSkin = errors.New("no skin for player")

const ttl = 24 * time.Hour

type Service struct {
	dir    string
	mojang *mojang.Client
	mu     sync.Mutex
	inTx   map[string]chan struct{} // de-duplicates concurrent fetches for one name
}

func New(dataDir string, client *mojang.Client) *Service {
	return &Service{dir: filepath.Join(dataDir, "skins"), mojang: client, inTx: map[string]chan struct{}{}}
}

// Skin returns the 64x64 (or legacy 64x32) skin PNG for a player name. Names are looked up on
// Mojang, so offline-mode players get the skin of the Mojang account with that name, if any.
func (s *Service) Skin(ctx context.Context, name string) ([]byte, error) {
	key := strings.ToLower(name)
	if data, ok := s.cached(key + ".png"); ok {
		if len(data) == 0 {
			return nil, ErrNoSkin // negative cache
		}
		return data, nil
	}
	// Single flight per name.
	s.mu.Lock()
	if ch, ok := s.inTx[key]; ok {
		s.mu.Unlock()
		<-ch
		return s.Skin(ctx, name)
	}
	ch := make(chan struct{})
	s.inTx[key] = ch
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.inTx, key)
		s.mu.Unlock()
		close(ch)
	}()

	data, err := s.fetch(ctx, name)
	if err != nil && !errors.Is(err, ErrNoSkin) {
		return nil, err
	}
	s.store(key+".png", data) // empty file = negative cache
	if err != nil {
		return nil, err
	}
	return data, nil
}

// Face returns the head (face + hat layer) as a size×size PNG, cached next to the skin.
func (s *Service) Face(ctx context.Context, name string, size int) ([]byte, error) {
	if size < 8 {
		size = 8
	}
	if size > 512 {
		size = 512
	}
	key := fmt.Sprintf("%s-%d.png", strings.ToLower(name), size)
	if data, ok := s.cached(key); ok && len(data) > 0 {
		return data, nil
	}
	skin, err := s.Skin(ctx, name)
	if err != nil {
		return nil, err
	}
	face, err := RenderFace(skin, size)
	if err != nil {
		return nil, err
	}
	s.store(key, face)
	return face, nil
}

func (s *Service) cached(file string) ([]byte, bool) {
	path := filepath.Join(s.dir, file)
	info, err := os.Stat(path)
	if err != nil || time.Since(info.ModTime()) >= ttl {
		return nil, false
	}
	data, err := os.ReadFile(path)
	return data, err == nil
}

func (s *Service) store(file string, data []byte) {
	_ = os.MkdirAll(s.dir, 0o750)
	_ = os.WriteFile(filepath.Join(s.dir, file), data, 0o640)
}

func (s *Service) fetch(ctx context.Context, name string) ([]byte, error) {
	id, err := s.mojang.ProfileID(ctx, name)
	if err == nil {
		var url string
		if url, err = s.mojang.SkinURL(ctx, id); err == nil {
			return s.download(ctx, url)
		}
	}
	if errors.Is(err, mojang.ErrNotFound) {
		return nil, ErrNoSkin
	}
	return nil, err
}

func (s *Service) download(ctx context.Context, url string) ([]byte, error) {
	resp, err := s.mojang.Get(ctx, url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(http.MaxBytesReader(nil, resp.Body, 1<<20)); err != nil {
		return nil, err
	}
	if _, err := png.Decode(bytes.NewReader(buf.Bytes())); err != nil {
		return nil, fmt.Errorf("skin is not a PNG: %w", err)
	}
	return buf.Bytes(), nil
}

// RenderFace crops the head (face + hat layer) of a skin and scales it nearest-neighbour so the
// pixels stay crisp.
func RenderFace(skin []byte, size int) ([]byte, error) {
	src, err := png.Decode(bytes.NewReader(skin))
	if err != nil {
		return nil, err
	}
	head := image.NewNRGBA(image.Rect(0, 0, 8, 8))
	draw.Draw(head, head.Bounds(), src, image.Pt(8, 8), draw.Src)
	// Legacy skins store an "empty" hat as opaque black rather than transparent; compositing that
	// would blank the face, so such a layer is skipped.
	if !solidBlack(src, image.Rect(40, 8, 48, 16)) {
		draw.Draw(head, head.Bounds(), src, image.Pt(40, 8), draw.Over)
	}
	out := image.NewNRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		sy := y * 8 / size
		for x := 0; x < size; x++ {
			copy(out.Pix[y*out.Stride+x*4:], head.Pix[sy*head.Stride+(x*8/size)*4:][:4])
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, out); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func solidBlack(img image.Image, r image.Rectangle) bool {
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			cr, cg, cb, ca := img.At(x, y).RGBA()
			if ca != 0xffff || cr != 0 || cg != 0 || cb != 0 {
				return false
			}
		}
	}
	return true
}
