package auth

import "net/http"

// The access model Beacon resolves and wardend enforces (ADR-017). Beacon carries the same tables in
// TypeScript (`beacon/lib/access.ts`); TestAccessVectors pins the pair against a shared set of cases.

// InstanceRole is what a principal may do on one instance. Ordered: each includes the previous.
type InstanceRole string

const (
	InstNone     InstanceRole = ""
	InstViewer   InstanceRole = "viewer"
	InstOperator InstanceRole = "operator"
	InstManager  InstanceRole = "manager"
)

var rank = map[InstanceRole]int{InstNone: 0, InstViewer: 1, InstOperator: 2, InstManager: 3}

// AllInstances is the instance id of a grant covering every instance of the node.
const AllInstances = "*"

// Cap is a power that is not tied to a single instance.
type Cap string

const (
	CapSystemUpdate    Cap = "system.update"
	CapJavaManage      Cap = "java.manage"
	CapInstanceCreate  Cap = "instances.create"
	CapInstanceDestroy Cap = "instances.delete"
	CapMembersManage   Cap = "members.manage"
)

// Action is what a request wants to do to an instance.
type Action string

const (
	ActionRead          Action = "read"
	ActionPower         Action = "power"          // start, stop, restart, kill
	ActionConsoleSend   Action = "console.send"   //
	ActionPlayersAction Action = "players.action" // message, kick
	ActionAccessWrite   Action = "access.write"   // whitelist, bans
	ActionOpsWrite      Action = "ops.write"      //
	ActionConfigWrite   Action = "config.write"   // server.properties, raw properties, config files
	ActionPluginsWrite  Action = "plugins.write"  //
	ActionBackupsWrite  Action = "backups.write"  //
	ActionSettingsWrite Action = "settings.write" // instance settings, upgrade, eula, install
)

var needs = map[Action]InstanceRole{
	ActionRead:          InstViewer,
	ActionPower:         InstOperator,
	ActionConsoleSend:   InstOperator,
	ActionPlayersAction: InstOperator,
	ActionAccessWrite:   InstOperator,
	ActionOpsWrite:      InstManager,
	ActionConfigWrite:   InstManager,
	ActionPluginsWrite:  InstManager,
	ActionBackupsWrite:  InstManager,
	ActionSettingsWrite: InstManager,
}

// stronger returns whichever role grants more.
func stronger(a, b InstanceRole) InstanceRole {
	if rank[a] >= rank[b] {
		return a
	}
	return b
}

// HasCap reports whether the principal holds a host or organization capability.
func (p Principal) HasCap(c Cap) bool {
	for _, got := range p.Caps {
		if got == c {
			return true
		}
	}
	return false
}

// RoleOn is the role the principal holds on one instance, blanket grant included.
func (p Principal) RoleOn(instanceID string) InstanceRole {
	return stronger(p.ACLAll, p.ACL[instanceID])
}

// CanSee reports whether the instance exists as far as this principal is concerned.
func (p Principal) CanSee(instanceID string) bool { return p.RoleOn(instanceID) != InstNone }

// Can reports whether the principal may perform the action on the instance.
func (p Principal) Can(instanceID string, a Action) bool {
	return rank[p.RoleOn(instanceID)] >= rank[needs[a]]
}

// RequireCap wraps a handler that needs a host or organization capability.
func RequireCap(c Cap, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p, ok := FromContext(r.Context())
		if !ok || !p.HasCap(c) {
			writeErr(w, http.StatusForbidden, "forbidden", string(c)+" is required")
			return
		}
		next(w, r)
	}
}

// OnInstance wraps a handler scoped to `{id}`. An instance the caller has no access to answers 404,
// not 403, so the set of instances on the node does not leak.
func OnInstance(a Action, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p, ok := FromContext(r.Context())
		id := r.PathValue("id")
		if !ok || !p.CanSee(id) {
			writeErr(w, http.StatusNotFound, "instance_not_found", "instance not found")
			return
		}
		if !p.Can(id, a) {
			writeErr(w, http.StatusForbidden, "forbidden", "role "+string(needs[a])+" is required on this instance")
			return
		}
		next(w, r)
	}
}
