package instance

import "fmt"

// aikarFlags are the PaperMC-recommended G1GC flags (https://docs.papermc.io/paper/aikars-flags/).
func aikarFlags(memMB int) []string {
	flags := []string{
		"-XX:+UseG1GC", "-XX:+ParallelRefProcEnabled", "-XX:MaxGCPauseMillis=200",
		"-XX:+UnlockExperimentalVMOptions", "-XX:+DisableExplicitGC", "-XX:+AlwaysPreTouch",
		"-XX:G1HeapWastePercent=5", "-XX:G1MixedGCCountTarget=4", "-XX:G1MixedGCLiveThresholdPercent=90",
		"-XX:G1RSetUpdatingPauseTimePercent=5", "-XX:SurvivorRatio=32", "-XX:+PerfDisableSharedMem",
		"-XX:MaxTenuringThreshold=1", "-Dusing.aikars.flags=https://mcflags.emc.gs", "-Daikars.new.flags=true",
	}
	if memMB >= 12*1024 {
		flags = append(flags, "-XX:G1NewSizePercent=40", "-XX:G1MaxNewSizePercent=50", "-XX:G1HeapRegionSize=16M",
			"-XX:G1ReservePercent=15", "-XX:InitiatingHeapOccupancyPercent=20")
	} else {
		flags = append(flags, "-XX:G1NewSizePercent=30", "-XX:G1MaxNewSizePercent=40", "-XX:G1HeapRegionSize=8M",
			"-XX:G1ReservePercent=20", "-XX:InitiatingHeapOccupancyPercent=15")
	}
	return flags
}

// JavaArgs builds the full argument list for `java`.
func (m *Manifest) JavaArgs() []string {
	args := []string{fmt.Sprintf("-Xms%dM", m.MemoryMB), fmt.Sprintf("-Xmx%dM", m.MemoryMB)}
	switch m.JVMPreset {
	case "aikar":
		args = append(args, aikarFlags(m.MemoryMB)...)
	case "custom":
		args = append(args, m.JVMFlags...)
	default: // basic
		args = append(args, "-XX:+UseG1GC")
	}
	// No JLine prompt / ANSI colours: stdout is consumed by wardend, not a terminal.
	args = append(args, "-Dterminal.jline=false", "-Dterminal.ansi=false", "-Dlog4j.skipJansi=true")
	args = append(args, "-jar", m.Jar, "--nogui")
	return args
}
