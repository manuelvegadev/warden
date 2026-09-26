package mc

import (
	"bufio"
	"compress/gzip"
	"compress/zlib"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"strconv"
)

// NBT is Minecraft's binary tag format (Java Edition: big-endian): level.dat, playerdata, maps,
// structures and schematics are NBT, usually gzipped. DecodeNBT reads one document into the tree
// the file manager draws (ADR-020); it only reads, and it never writes NBT back.

// NBTNode is one tag. Scalars carry Value (a long as a string, so JavaScript keeps every digit;
// a float that is not a finite number as its name); compounds and lists carry Items, in file
// order; arrays carry Value as their first numbers and Len when they hold more.
type NBTNode struct {
	Name  string    `json:"k,omitempty"`
	Type  string    `json:"t"`
	Value any       `json:"v,omitempty"`
	Items []NBTNode `json:"c,omitempty"`
	// Len is the whole length of an array or list shown in part.
	Len int `json:"n,omitempty"`
	// Of is the element type of a list.
	Of string `json:"of,omitempty"`
}

const (
	nbtMaxBytes = 64 << 20 // decompressed; a bigger document is not something to read in a browser
	nbtMaxDepth = 512
	nbtMaxNodes = 200_000
	// nbtShown is how many elements of an array or a list are kept; the rest are counted and skipped.
	nbtShown = 512
)

var (
	ErrNBTTooLarge = errors.New("nbt: document too large to show")
	ErrNBTInvalid  = errors.New("nbt: not a valid NBT document")
)

var nbtTypes = [...]string{"end", "byte", "short", "int", "long", "float", "double", "byteArray", "string", "list",
	"compound", "intArray", "longArray"}

// NBTCompression names how a document is stored, from its first bytes: gzip (level.dat,
// playerdata, schematics), zlib (a chunk inside a region file), or none (structure files some
// tools write raw).
func NBTCompression(head []byte) string {
	switch {
	case len(head) >= 2 && head[0] == 0x1f && head[1] == 0x8b:
		return "gzip"
	case len(head) >= 2 && head[0] == 0x78 && (uint16(head[0])<<8|uint16(head[1]))%31 == 0:
		return "zlib"
	}
	return "none"
}

// DecodeNBT reads an NBT document, decompressing it first when it is gzip or zlib; the second
// result is the compression found.
func DecodeNBT(r io.Reader) (NBTNode, string, error) {
	br := bufio.NewReader(r)
	head, _ := br.Peek(2)
	compression := NBTCompression(head)
	var src io.Reader = br
	switch compression {
	case "gzip":
		zr, err := gzip.NewReader(br)
		if err != nil {
			return NBTNode{}, compression, ErrNBTInvalid
		}
		defer zr.Close()
		src = zr
	case "zlib":
		zr, err := zlib.NewReader(br)
		if err != nil {
			return NBTNode{}, compression, ErrNBTInvalid
		}
		defer zr.Close()
		src = zr
	}
	d := &nbtDecoder{r: bufio.NewReader(&capped{r: src, left: nbtMaxBytes})}
	root, err := d.root()
	return root, compression, err
}

// capped fails the read that goes past the limit, rather than ending the stream quietly as
// io.LimitReader would, so a document cut off by the cap is told apart from a short one.
type capped struct {
	r    io.Reader
	left int64
}

func (c *capped) Read(p []byte) (int, error) {
	if c.left <= 0 {
		return 0, ErrNBTTooLarge
	}
	if int64(len(p)) > c.left {
		p = p[:c.left]
	}
	n, err := c.r.Read(p)
	c.left -= int64(n)
	return n, err
}

type nbtDecoder struct {
	r     *bufio.Reader
	nodes int
}

func (d *nbtDecoder) root() (NBTNode, error) {
	t, err := d.r.ReadByte()
	if err != nil {
		return NBTNode{}, d.fail(err)
	}
	if t != 10 && t != 9 { // a document is a named compound (a list, for a few tools)
		return NBTNode{}, ErrNBTInvalid
	}
	name, err := d.str()
	if err != nil {
		return NBTNode{}, err
	}
	n, err := d.payload(t, 0, true)
	n.Name = name
	return n, err
}

// fail turns running out of bytes into "not NBT", and keeps the size cap's own error.
func (d *nbtDecoder) fail(err error) error {
	if errors.Is(err, ErrNBTTooLarge) {
		return ErrNBTTooLarge
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return ErrNBTInvalid
	}
	return err
}

func (d *nbtDecoder) read(n int) ([]byte, error) {
	buf := make([]byte, n)
	if _, err := io.ReadFull(d.r, buf); err != nil {
		return nil, d.fail(err)
	}
	return buf, nil
}

func (d *nbtDecoder) skip(n int64) error {
	if _, err := io.CopyN(io.Discard, d.r, n); err != nil {
		return d.fail(err)
	}
	return nil
}

func (d *nbtDecoder) str() (string, error) {
	b, err := d.read(2)
	if err != nil {
		return "", err
	}
	s, err := d.read(int(binary.BigEndian.Uint16(b)))
	// Java's modified UTF-8 is UTF-8 but for NUL and characters outside the BMP; JSON encoding
	// replaces what does not decode, which is what a viewer wants.
	return string(s), err
}

func (d *nbtDecoder) length() (int, error) {
	b, err := d.read(4)
	if err != nil {
		return 0, err
	}
	n := int32(binary.BigEndian.Uint32(b))
	if n < 0 {
		return 0, ErrNBTInvalid
	}
	return int(n), nil
}

func float(f float64) any {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return strconv.FormatFloat(f, 'g', -1, 64) // "NaN", "+Inf": JSON has no such numbers
	}
	return f
}

// payload reads one tag's value. With build false it is only consumed: the elements of a big
// array or list beyond the ones shown.
func (d *nbtDecoder) payload(t byte, depth int, build bool) (NBTNode, error) {
	if depth > nbtMaxDepth {
		return NBTNode{}, ErrNBTInvalid
	}
	if int(t) >= len(nbtTypes) || t == 0 {
		return NBTNode{}, fmt.Errorf("%w: tag type %d", ErrNBTInvalid, t)
	}
	if build {
		d.nodes++
		if d.nodes > nbtMaxNodes {
			return NBTNode{}, ErrNBTTooLarge
		}
	}
	n := NBTNode{Type: nbtTypes[t]}
	switch t {
	case 1, 2, 3, 4, 5, 6:
		size := [...]int{1: 1, 2: 2, 3: 4, 4: 8, 5: 4, 6: 8}[t]
		b, err := d.read(size)
		if err != nil {
			return n, err
		}
		if !build {
			return n, nil
		}
		switch t {
		case 1:
			n.Value = int8(b[0])
		case 2:
			n.Value = int16(binary.BigEndian.Uint16(b))
		case 3:
			n.Value = int32(binary.BigEndian.Uint32(b))
		case 4:
			n.Value = strconv.FormatInt(int64(binary.BigEndian.Uint64(b)), 10)
		case 5:
			n.Value = float(float64(math.Float32frombits(binary.BigEndian.Uint32(b))))
		case 6:
			n.Value = float(math.Float64frombits(binary.BigEndian.Uint64(b)))
		}
		return n, nil
	case 8:
		s, err := d.str()
		if build {
			n.Value = s
		}
		return n, err
	case 7, 11, 12:
		count, err := d.length()
		if err != nil {
			return n, err
		}
		size := map[byte]int{7: 1, 11: 4, 12: 8}[t]
		shown := count
		if !build {
			shown = 0
		} else if shown > nbtShown {
			shown = nbtShown
			n.Len = count
		}
		values := make([]any, 0, shown)
		for i := 0; i < shown; i++ {
			b, err := d.read(size)
			if err != nil {
				return n, err
			}
			switch t {
			case 7:
				values = append(values, int8(b[0]))
			case 11:
				values = append(values, int32(binary.BigEndian.Uint32(b)))
			case 12:
				values = append(values, strconv.FormatInt(int64(binary.BigEndian.Uint64(b)), 10))
			}
		}
		if build {
			n.Value = values
		}
		return n, d.skip(int64(count-shown) * int64(size))
	case 9:
		et, err := d.r.ReadByte()
		if err != nil {
			return n, d.fail(err)
		}
		count, err := d.length()
		if err != nil {
			return n, err
		}
		if int(et) >= len(nbtTypes) || (et == 0 && count > 0) {
			return n, ErrNBTInvalid
		}
		n.Of = nbtTypes[et]
		for i := 0; i < count; i++ {
			keep := build && i < nbtShown
			item, err := d.payload(et, depth+1, keep)
			if err != nil {
				return n, err
			}
			if keep {
				n.Items = append(n.Items, item)
			}
		}
		if build && count > nbtShown {
			n.Len = count
		}
		return n, nil
	case 10:
		for {
			ct, err := d.r.ReadByte()
			if err != nil {
				return n, d.fail(err)
			}
			if ct == 0 {
				return n, nil
			}
			name, err := d.str()
			if err != nil {
				return n, err
			}
			child, err := d.payload(ct, depth+1, build)
			if err != nil {
				return n, err
			}
			if build {
				child.Name = name
				n.Items = append(n.Items, child)
			}
		}
	}
	return n, nil
}

// ReadNBTFile decodes the NBT document in a file.
func ReadNBTFile(name string) (NBTNode, string, error) {
	f, err := os.Open(name)
	if err != nil {
		return NBTNode{}, "", err
	}
	defer f.Close()
	return DecodeNBT(f)
}
