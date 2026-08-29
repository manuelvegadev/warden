"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/utils";

/** Live "1h 2m" / "5m 12s" since `startedAt`; "—" when unset. Computed after mount so SSR and hydration match. */
export function useUptime(startedAt?: string) {
  const [text, setText] = useState("—");
  useEffect(() => {
    if (!startedAt) {
      setText("—");
      return;
    }
    const tick = () =>
      setText(formatDuration(Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)), true));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return text;
}

/** Leaf component so the 1 s tick re-renders only this text, not its parent. */
export function Uptime({ startedAt }: { startedAt?: string }) {
  return <>{useUptime(startedAt)}</>;
}
