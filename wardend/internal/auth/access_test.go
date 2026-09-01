package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/lestrrat-go/jwx/v3/jwt"
)

// The access model is enforced twice — here and in beacon/lib/access.ts — so the vectors live in
// one file that both suites load (../../../access-vectors.json). TestAccessVectors also asserts
// that every Action is covered, so an action added on one side fails the other side's test.
type accessVector struct {
	Name     string                  `json:"name"`
	ACLAll   InstanceRole            `json:"aclAll"`
	ACL      map[string]InstanceRole `json:"acl"`
	Instance string                  `json:"instance"`
	Allowed  []Action                `json:"allowed"`
	Denied   []Action                `json:"denied"`
}

func loadVectors(t *testing.T) []accessVector {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "access-vectors.json"))
	if err != nil {
		t.Fatalf("read the shared vectors: %v", err)
	}
	var file struct {
		Vectors []accessVector `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("parse the shared vectors: %v", err)
	}
	if len(file.Vectors) == 0 {
		t.Fatal("the shared vectors file is empty")
	}
	return file.Vectors
}

func TestAccessVectors(t *testing.T) {
	for _, v := range loadVectors(t) {
		t.Run(v.Name, func(t *testing.T) {
			p := Principal{ACLAll: v.ACLAll, ACL: v.ACL}
			for _, a := range v.Allowed {
				if !p.Can(v.Instance, a) {
					t.Errorf("%s on %s: want allowed, got denied", a, v.Instance)
				}
			}
			for _, a := range v.Denied {
				if p.Can(v.Instance, a) {
					t.Errorf("%s on %s: want denied, got allowed", a, v.Instance)
				}
			}
		})
	}
}

// A new Action with no vector would be enforced here and unchecked in Beacon (or the other way
// round), which is exactly the drift the shared file exists to prevent.
func TestEveryActionIsCoveredByAVector(t *testing.T) {
	seen := map[Action]bool{}
	for _, v := range loadVectors(t) {
		for _, a := range append(append([]Action{}, v.Allowed...), v.Denied...) {
			seen[a] = true
		}
	}
	for a := range needs {
		if !seen[a] {
			t.Errorf("action %q has no vector in access-vectors.json", a)
		}
	}
}

func TestCanSee(t *testing.T) {
	p := Principal{ACL: map[string]InstanceRole{"survival": InstViewer}}
	if !p.CanSee("survival") {
		t.Error("a viewer must see the instance they were granted")
	}
	if p.CanSee("creative") {
		t.Error("an instance with no grant must be invisible")
	}
	if (Principal{ACLAll: InstViewer}).CanSee("anything") == false {
		t.Error("a blanket grant must cover unlisted instances")
	}
}

func TestHasCap(t *testing.T) {
	p := Principal{Caps: []Cap{CapJavaManage, CapInstanceCreate}}
	if !p.HasCap(CapInstanceCreate) {
		t.Error("granted capability reported as missing")
	}
	if p.HasCap(CapSystemUpdate) {
		t.Error("ungranted capability reported as held")
	}
	if (Principal{}).HasCap(CapJavaManage) {
		t.Error("a principal with no capabilities must hold none")
	}
}

func token(t *testing.T, claims map[string]any) jwt.Token {
	t.Helper()
	b := jwt.NewBuilder().Subject("u1").Expiration(time.Now().Add(time.Minute))
	for k, v := range claims {
		b = b.Claim(k, v)
	}
	tok, err := b.Build()
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func TestReadAccessFromClaims(t *testing.T) {
	p := &Principal{Role: RoleOperator}
	readAccess(token(t, map[string]any{
		"caps":   []any{"instances.create", "members.manage"},
		"aclAll": "viewer",
		"acl":    map[string]any{"survival": "manager"},
	}), p)

	if !p.HasCap(CapInstanceCreate) || !p.HasCap(CapMembersManage) {
		t.Errorf("caps = %v", p.Caps)
	}
	if p.ACLAll != InstViewer {
		t.Errorf("aclAll = %q", p.ACLAll)
	}
	if p.RoleOn("survival") != InstManager || p.RoleOn("creative") != InstViewer {
		t.Errorf("acl = %v", p.ACL)
	}
}

// A panel that predates ADR-017 sends no access claims; the host role has to stand in for them, or
// a rolling upgrade would lock everyone out.
func TestReadAccessFallsBackToTheHostRole(t *testing.T) {
	admin := &Principal{Role: RoleAdmin}
	readAccess(token(t, nil), admin)
	if admin.ACLAll != InstManager || !admin.HasCap(CapSystemUpdate) || !admin.HasCap(CapInstanceDestroy) {
		t.Errorf("admin fallback: aclAll=%q caps=%v", admin.ACLAll, admin.Caps)
	}

	operator := &Principal{Role: RoleOperator}
	readAccess(token(t, nil), operator)
	if operator.ACLAll != InstOperator {
		t.Errorf("operator fallback: aclAll = %q", operator.ACLAll)
	}
	if len(operator.Caps) != 0 {
		t.Errorf("operator fallback must grant no capability, got %v", operator.Caps)
	}
}

// An empty acl map is still an ADR-017 token: it means "no instances", not "fall back to the role".
func TestReadAccessTreatsEmptyClaimsAsDeliberate(t *testing.T) {
	p := &Principal{Role: RoleOperator}
	readAccess(token(t, map[string]any{"caps": []any{}, "acl": map[string]any{}}), p)
	if p.ACLAll != InstNone || len(p.ACL) != 0 {
		t.Errorf("aclAll=%q acl=%v; a member with no grants must reach nothing", p.ACLAll, p.ACL)
	}
}

// An instance the caller cannot see must answer 404, so the list of instances on the node stays
// private; one they can see but may not change answers 403.
func TestOnInstanceHides404AndForbids403(t *testing.T) {
	for _, tc := range []struct {
		name     string
		p        Principal
		instance string
		want     int
	}{
		{"no grant at all", Principal{}, "survival", http.StatusNotFound},
		{"grant on another instance", Principal{ACL: map[string]InstanceRole{"creative": InstManager}}, "survival", http.StatusNotFound},
		{"visible but too weak", Principal{ACL: map[string]InstanceRole{"survival": InstViewer}}, "survival", http.StatusForbidden},
		{"strong enough", Principal{ACL: map[string]InstanceRole{"survival": InstManager}}, "survival", http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mux := http.NewServeMux()
			mux.HandleFunc("GET /instances/{id}", OnInstance(ActionConfigWrite, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))
			req := httptest.NewRequest(http.MethodGet, "/instances/"+tc.instance, nil)
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req.WithContext(WithPrincipal(req.Context(), &tc.p)))
			if rec.Code != tc.want {
				t.Errorf("status = %d, want %d", rec.Code, tc.want)
			}
		})
	}
}

func TestRequireCap(t *testing.T) {
	h := RequireCap(CapJavaManage, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	for _, tc := range []struct {
		name string
		p    Principal
		want int
	}{
		{"held", Principal{Caps: []Cap{CapJavaManage}}, http.StatusOK},
		{"missing", Principal{Caps: []Cap{CapInstanceCreate}}, http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/java", nil)
			rec := httptest.NewRecorder()
			h(rec, req.WithContext(WithPrincipal(req.Context(), &tc.p)))
			if rec.Code != tc.want {
				t.Errorf("status = %d, want %d", rec.Code, tc.want)
			}
		})
	}
}
