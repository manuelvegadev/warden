"use client";

import { useEffect, useState } from "react";
import { instances } from "@/lib/api";

/**
 * The instance's `server-icon.png`, or null when it has none.
 *
 * The daemon answers 404 for an instance without one, so existence is settled by loading it: the
 * probe's response is what the `<img>` then shows from cache. `version` is bumped by whoever
 * uploads a new icon, so the URL changes and the browser fetches again instead of reusing the old
 * bytes.
 */
export function useServerIcon(id: string, version = 0): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const url = `${instances.serverIconUrl(id)}?v=${version}`;
    const probe = new Image();
    probe.onload = () => setSrc(url);
    probe.onerror = () => setSrc(null);
    probe.src = url;
    return () => {
      probe.onload = null;
      probe.onerror = null;
    };
  }, [id, version]);
  return src;
}
