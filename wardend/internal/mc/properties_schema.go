package mc

// PropertySpec documents one server.properties key (https://minecraft.wiki/w/Server.properties).
type PropertySpec struct {
	Key             string   `json:"key"`
	Type            string   `json:"type"` // bool | int | string | enum
	Default         string   `json:"default"`
	Enum            []string `json:"enum,omitempty"`
	Min             *int     `json:"min,omitempty"`
	Max             *int     `json:"max,omitempty"`
	Group           string   `json:"group"`
	Description     string   `json:"description"`
	RequiresRestart bool     `json:"requiresRestart"`
	Managed         bool     `json:"managed,omitempty"` // owned by wardend (port, rcon); edited elsewhere
	Common          bool     `json:"common,omitempty"`  // shown first in the UI: what most admins touch
	// LiveCommand, when set, applies a new value to a running server without a restart.
	LiveCommand func(value string) string `json:"-"`
}

func onOff(cmd string) func(string) string {
	return func(v string) string {
		if v == "true" {
			return cmd + " on"
		}
		return cmd + " off"
	}
}

func ip(v int) *int { return &v }

// PropertySchema lists the keys the UI knows how to edit, in display order. Unknown keys are still
// returned by the API as free-form strings.
var PropertySchema = []PropertySpec{
	// General
	{Key: "motd", Type: "string", Default: "A Minecraft Server", Group: "General", Description: "Message shown in the server list. Supports § colour codes.", RequiresRestart: true, Common: true},
	{Key: "max-players", Type: "int", Default: "20", Min: ip(0), Max: ip(2147483647), Group: "General", Description: "Maximum number of players allowed at once.", RequiresRestart: true, Common: true},
	{Key: "gamemode", Type: "enum", Default: "survival", Enum: []string{"survival", "creative", "adventure", "spectator"}, Group: "General", Description: "Default game mode for new players.", RequiresRestart: true, Common: true},
	{Key: "force-gamemode", Type: "bool", Default: "false", Group: "General", Description: "Force players to the default game mode on join.", RequiresRestart: true},
	// Enum order is part of the contract for keys the panel renders as a scale (difficulty):
	// Beacon takes the slider position from the index, so these stay ordered low to high.
	{Key: "difficulty", Type: "enum", Default: "easy", Enum: []string{"peaceful", "easy", "normal", "hard"}, Group: "General", Description: "World difficulty.", RequiresRestart: true, Common: true},
	{Key: "hardcore", Type: "bool", Default: "false", Group: "General", Description: "Players are banned on death; difficulty locked to hard.", RequiresRestart: true, Common: true},
	{Key: "pvp", Type: "bool", Default: "true", Group: "General", Description: "Allow players to hurt each other.", RequiresRestart: true, Common: true},
	{Key: "allow-flight", Type: "bool", Default: "false", Group: "General", Description: "Allow flying in survival (e.g. mods); otherwise flying players are kicked.", RequiresRestart: true, Common: true},
	{Key: "enable-command-block", Type: "bool", Default: "false", Group: "General", Description: "Enable command blocks.", RequiresRestart: true},
	{Key: "op-permission-level", Type: "int", Default: "4", Min: ip(1), Max: ip(4), Group: "General", Description: "Permission level given by /op.", RequiresRestart: true},
	{Key: "function-permission-level", Type: "int", Default: "2", Min: ip(1), Max: ip(4), Group: "General", Description: "Permission level for functions.", RequiresRestart: true},
	// World
	{Key: "level-name", Type: "string", Default: "world", Group: "World", Description: "World folder name. Changing it loads/creates a different world.", RequiresRestart: true, Common: true},
	{Key: "level-seed", Type: "string", Default: "", Group: "World", Description: "Seed used when the world is created. Has no effect on existing worlds.", RequiresRestart: true, Common: true},
	{Key: "level-type", Type: "enum", Default: "minecraft:normal", Enum: []string{"minecraft:normal", "minecraft:flat", "minecraft:large_biomes", "minecraft:amplified", "minecraft:single_biome_surface"}, Group: "World", Description: "World generator preset (new worlds only).", RequiresRestart: true},
	{Key: "generate-structures", Type: "bool", Default: "true", Group: "World", Description: "Generate villages, strongholds, etc.", RequiresRestart: true},
	{Key: "allow-nether", Type: "bool", Default: "true", Group: "World", Description: "Allow travelling to the Nether.", RequiresRestart: true},
	{Key: "spawn-protection", Type: "int", Default: "16", Min: ip(0), Max: ip(100000), Group: "World", Description: "Radius around spawn that non-ops cannot modify (0 disables).", RequiresRestart: true, Common: true},
	{Key: "max-world-size", Type: "int", Default: "29999984", Min: ip(1), Max: ip(29999984), Group: "World", Description: "World border radius in blocks.", RequiresRestart: true},
	{Key: "view-distance", Type: "int", Default: "10", Min: ip(3), Max: ip(32), Group: "World", Description: "Chunks sent to each player. Main lever for RAM/CPU.", RequiresRestart: true, Common: true},
	{Key: "simulation-distance", Type: "int", Default: "10", Min: ip(3), Max: ip(32), Group: "World", Description: "Chunks around players that tick (mobs, crops…).", RequiresRestart: true, Common: true},
	{Key: "entity-broadcast-range-percentage", Type: "int", Default: "100", Min: ip(10), Max: ip(1000), Group: "World", Description: "How far entities are visible, as a percentage.", RequiresRestart: true},
	{Key: "spawn-monsters", Type: "bool", Default: "true", Group: "World", Description: "Spawn hostile mobs.", RequiresRestart: true, Common: true},
	// Players
	{Key: "online-mode", Type: "bool", Default: "true", Group: "Players", Description: "Verify accounts with Mojang. Keep enabled unless a proxy (Velocity) handles auth.", RequiresRestart: true, Common: true},
	{Key: "white-list", Type: "bool", Default: "false", Group: "Players", Description: "Only players on the whitelist can join.", Common: true, LiveCommand: onOff("whitelist")},
	{Key: "enforce-whitelist", Type: "bool", Default: "false", Group: "Players", Description: "Kick online players that are removed from the whitelist.", RequiresRestart: true},
	{Key: "player-idle-timeout", Type: "int", Default: "0", Min: ip(0), Max: ip(1440), Group: "Players", Description: "Kick idle players after N minutes (0 disables).", RequiresRestart: true},
	{Key: "enforce-secure-profile", Type: "bool", Default: "true", Group: "Players", Description: "Require Mojang-signed chat profiles.", RequiresRestart: true},
	{Key: "hide-online-players", Type: "bool", Default: "false", Group: "Players", Description: "Hide the player list in the server list ping.", RequiresRestart: true},
	{Key: "resource-pack", Type: "string", Default: "", Group: "Players", Description: "URL of a resource pack offered to players.", RequiresRestart: true},
	{Key: "require-resource-pack", Type: "bool", Default: "false", Group: "Players", Description: "Disconnect players that decline the resource pack.", RequiresRestart: true},
	// Network
	{Key: "server-port", Type: "int", Default: "25565", Min: ip(1), Max: ip(65535), Group: "Network", Description: "Game port. Managed from the instance settings.", RequiresRestart: true, Managed: true},
	{Key: "server-ip", Type: "string", Default: "", Group: "Network", Description: "Bind address. Leave empty to listen on all interfaces.", RequiresRestart: true},
	{Key: "network-compression-threshold", Type: "int", Default: "256", Min: ip(-1), Max: ip(65535), Group: "Network", Description: "Packets larger than this are compressed (-1 disables).", RequiresRestart: true},
	{Key: "max-tick-time", Type: "int", Default: "60000", Min: ip(-1), Max: ip(2147483647), Group: "Network", Description: "Watchdog: kill the server if a tick takes longer (ms). -1 disables.", RequiresRestart: true},
	{Key: "enable-query", Type: "bool", Default: "false", Group: "Network", Description: "GameSpy4 query listener (UDP).", RequiresRestart: true},
	{Key: "enable-rcon", Type: "bool", Default: "false", Group: "Network", Description: "RCON is managed by wardend (console goes through stdin).", RequiresRestart: true, Managed: true},
	{Key: "enable-status", Type: "bool", Default: "true", Group: "Network", Description: "Answer server list pings.", RequiresRestart: true},
	{Key: "prevent-proxy-connections", Type: "bool", Default: "false", Group: "Network", Description: "Reject players whose ISP/proxy differs from Mojang's view.", RequiresRestart: true},
	{Key: "rate-limit", Type: "int", Default: "0", Min: ip(0), Max: ip(2147483647), Group: "Network", Description: "Max packets per second per client before kicking (0 disables).", RequiresRestart: true},
}

var specIndex = func() map[string]*PropertySpec {
	m := make(map[string]*PropertySpec, len(PropertySchema))
	for i := range PropertySchema {
		m[PropertySchema[i].Key] = &PropertySchema[i]
	}
	return m
}()

// SpecFor returns the schema entry for key, or nil for unknown keys.
func SpecFor(key string) *PropertySpec { return specIndex[key] }
