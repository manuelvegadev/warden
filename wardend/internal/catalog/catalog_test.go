package catalog

import (
	"strconv"
	"testing"
	"time"
)

func TestLoaderID(t *testing.T) {
	if loaderID("0.16.14") >= loaderID("0.17.0") || loaderID("0.16.9") >= loaderID("0.16.14") {
		t.Fatal("loader ids must be monotonic")
	}
}

func TestCacheStaysBoundedAsSearchesPileUp(t *testing.T) {
	c := newCache(time.Minute)
	for i := range cacheMax + 100 {
		c.set("search:"+strconv.Itoa(i), i)
	}
	if len(c.items) != cacheMax {
		t.Fatalf("%d entries, want %d", len(c.items), cacheMax)
	}
	if _, ok := c.get("search:0"); ok {
		t.Error("the entry closest to expiring should have made room")
	}
	if v, ok := c.get("search:" + strconv.Itoa(cacheMax+99)); !ok || v != cacheMax+99 {
		t.Error("the newest entry must be kept")
	}
}

func TestCacheDropsExpiredEntriesBeforeLiveOnes(t *testing.T) {
	c := newCache(time.Minute)
	for i := range cacheMax {
		c.set(strconv.Itoa(i), i)
	}
	c.items["0"] = cacheItem{exp: time.Now().Add(time.Hour), val: 0} // lives longest
	c.items["1"] = cacheItem{exp: time.Now().Add(-time.Second), val: 1}
	c.set("new", 0)
	if _, ok := c.items["1"]; ok {
		t.Error("the expired entry is dropped")
	}
	if len(c.items) != cacheMax {
		t.Errorf("dropping expired entries made room; %d entries", len(c.items))
	}
	if _, ok := c.items["0"]; !ok {
		t.Error("no live entry is dropped while an expired one can go")
	}
}
