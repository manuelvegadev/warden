package mc

import (
	"bytes"
	"compress/gzip"
	"compress/zlib"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math"
	"testing"
)

// A tiny NBT writer, only to build test documents.
type nbtw struct{ bytes.Buffer }

func (w *nbtw) str(s string) *nbtw {
	_ = binary.Write(&w.Buffer, binary.BigEndian, uint16(len(s)))
	w.WriteString(s)
	return w
}
func (w *nbtw) tag(t byte, name string) *nbtw { w.WriteByte(t); return w.str(name) }
func (w *nbtw) be(v any) *nbtw                { _ = binary.Write(&w.Buffer, binary.BigEndian, v); return w }
func (w *nbtw) end() *nbtw                    { w.WriteByte(0); return w }

// level returns a small level.dat-like document: Data{LevelName, Time, hardcore, Pos list, seed long array}.
func level() []byte {
	w := &nbtw{}
	w.tag(10, "")
	w.tag(10, "Data")
	w.tag(8, "LevelName").str("world")
	w.tag(4, "Time").be(int64(9_007_199_254_740_993)) // 2^53+1: a JavaScript number would lose it
	w.tag(1, "hardcore").be(int8(0))
	w.tag(9, "Pos").be(byte(6)).be(int32(3)).be(1.5).be(64.0).be(-2.25)
	w.tag(11, "Ints").be(int32(2)).be(int32(7)).be(int32(-1))
	w.tag(5, "Weird").be(float32(math.NaN()))
	w.end()
	w.end()
	return w.Bytes()
}

func find(n NBTNode, path ...string) NBTNode {
	for _, k := range path {
		for _, c := range n.Items {
			if c.Name == k {
				n = c
				break
			}
		}
	}
	return n
}

func TestNBTDecodesATreeInFileOrder(t *testing.T) {
	root, compression, err := DecodeNBT(bytes.NewReader(level()))
	if err != nil {
		t.Fatal(err)
	}
	if compression != "none" {
		t.Errorf("compression = %s", compression)
	}
	data := find(root, "Data")
	var names []string
	for _, c := range data.Items {
		names = append(names, c.Name)
	}
	if got := names; len(got) != 6 || got[0] != "LevelName" || got[5] != "Weird" {
		t.Errorf("order = %v", got)
	}
	if v := find(root, "Data", "LevelName").Value; v != "world" {
		t.Errorf("LevelName = %v", v)
	}
	if v := find(root, "Data", "Time").Value; v != "9007199254740993" {
		t.Errorf("a long is kept whole as a string: %v", v)
	}
	if v := find(root, "Data", "hardcore").Value; v != int8(0) {
		t.Errorf("a zero byte is still a value: %#v", v)
	}
	pos := find(root, "Data", "Pos")
	if pos.Type != "list" || pos.Of != "double" || len(pos.Items) != 3 || pos.Items[2].Value != -2.25 {
		t.Errorf("Pos = %+v", pos)
	}
	if v := find(root, "Data", "Weird").Value; v != "NaN" {
		t.Errorf("a NaN float is named, since JSON has no NaN: %v", v)
	}
	if _, err := json.Marshal(root); err != nil {
		t.Errorf("the tree must encode as JSON: %v", err)
	}
}

func TestNBTReadsGzipAndZlib(t *testing.T) {
	for _, tc := range []struct {
		name string
		pack func([]byte) []byte
	}{
		{"gzip", func(b []byte) []byte {
			var buf bytes.Buffer
			zw := gzip.NewWriter(&buf)
			zw.Write(b)
			zw.Close()
			return buf.Bytes()
		}},
		{"zlib", func(b []byte) []byte {
			var buf bytes.Buffer
			zw := zlib.NewWriter(&buf)
			zw.Write(b)
			zw.Close()
			return buf.Bytes()
		}},
	} {
		root, compression, err := DecodeNBT(bytes.NewReader(tc.pack(level())))
		if err != nil || compression != tc.name || find(root, "Data", "LevelName").Value != "world" {
			t.Errorf("%s: compression %s, err %v", tc.name, compression, err)
		}
	}
}

func TestNBTShowsTheStartOfABigArrayAndCountsTheRest(t *testing.T) {
	w := &nbtw{}
	w.tag(10, "")
	w.tag(7, "Blocks").be(int32(2000)).Write(make([]byte, 2000))
	w.tag(9, "Many").be(byte(3)).be(int32(1000))
	for i := 0; i < 1000; i++ {
		w.be(int32(i))
	}
	w.tag(8, "After").str("still read")
	w.end()
	root, _, err := DecodeNBT(bytes.NewReader(w.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	blocks := find(root, "Blocks")
	if blocks.Len != 2000 || len(blocks.Value.([]any)) != nbtShown {
		t.Errorf("array: len %d, shown %d", blocks.Len, len(blocks.Value.([]any)))
	}
	many := find(root, "Many")
	if many.Len != 1000 || len(many.Items) != nbtShown {
		t.Errorf("list: len %d, shown %d", many.Len, len(many.Items))
	}
	if find(root, "After").Value != "still read" {
		t.Error("what follows a skipped tail is still read")
	}
}

func TestNBTRefusesWhatIsNotNBT(t *testing.T) {
	for name, doc := range map[string][]byte{
		"text":      []byte("hello world"),
		"truncated": level()[:20],
		"bad type":  append((&nbtw{}).tag(10, "").Bytes(), 42, 0, 0),
		"empty":     {},
	} {
		if _, _, err := DecodeNBT(bytes.NewReader(doc)); !errors.Is(err, ErrNBTInvalid) {
			t.Errorf("%s: err = %v, want ErrNBTInvalid", name, err)
		}
	}
}
