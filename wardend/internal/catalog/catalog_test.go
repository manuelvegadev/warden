package catalog

import "testing"

func TestLoaderID(t *testing.T) {
	if loaderID("0.16.14") >= loaderID("0.17.0") || loaderID("0.16.9") >= loaderID("0.16.14") {
		t.Fatal("loader ids must be monotonic")
	}
}
