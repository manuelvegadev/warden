"use client";

import { useEffect, useState } from "react";
import { system } from "@/lib/api";
import { BEACON_VERSION } from "@/lib/version";

/** "wardend v0.2.0 · beacon v0.2.0" for the sidebar footer: tells at a glance whether a deploy landed. */
export function Versions() {
  const [daemon, setDaemon] = useState<string>();
  useEffect(() => {
    system.get().then(
      (s) => setDaemon(s.daemonVersion),
      () => setDaemon("offline"),
    );
  }, []);
  return (
    <div className="truncate px-2 font-mono text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden">
      wardend {daemon ?? "…"} · beacon {BEACON_VERSION}
    </div>
  );
}
