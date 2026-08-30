"use client";

import { useEffect, useState } from "react";
import { instances } from "@/lib/api";

// One request per instance shared by every consumer on the page; dropped when the online list changes.
const cache = new Map<string, Promise<string[]>>();

/**
 * Names of everyone who has ever joined the instance, most recent first. Pass the online list to
 * refetch on joins and leaves.
 */
export function useKnownPlayers(id: string, online: readonly string[] = []): string[] {
  const [names, setNames] = useState<string[]>([]);
  const key = `${id}\n${online.join(",")}`;
  useEffect(() => {
    let promise = cache.get(key);
    if (!promise) {
      cache.clear();
      promise = instances.players(id).then(
        (ps) => [...ps].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)).map((p) => p.name),
        () => [],
      );
      cache.set(key, promise);
    }
    let live = true;
    promise.then((ns) => live && setNames(ns));
    return () => {
      live = false;
    };
  }, [id, key]);
  return names;
}
