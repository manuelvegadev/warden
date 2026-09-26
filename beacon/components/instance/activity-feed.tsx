"use client";

import { Headphones, type LucideIcon, Mic } from "lucide-react";
import { PlayerName } from "@/components/instance/player-face";
import type { ServerEvent } from "@/lib/api";
import { formatWhen } from "@/lib/utils";

/** The event kinds the activity list shows: what to fetch, how each reads, which carry the voice icon. */
const EVENTS: Record<string, { describe: (e: ServerEvent) => string; icon?: LucideIcon }> = {
  "player.join": { describe: () => "joined" },
  "player.leave": { describe: () => "left" },
  "player.advancement": { describe: (e) => `earned “${e.text}”` },
  "player.chat": { describe: (e) => `said “${e.text}”` },
  "voice.listen.start": { describe: () => "started listening to voice chat from Beacon", icon: Headphones },
  "voice.listen.stop": { describe: () => "stopped listening to voice chat from Beacon", icon: Headphones },
  "voice.speak.start": { describe: () => "started speaking from Beacon", icon: Mic },
  "voice.speak.stop": { describe: () => "stopped speaking from Beacon", icon: Mic },
};

/** The kinds to ask the daemon for (`instances.events`). */
export const ACTIVITY_KINDS = Object.keys(EVENTS);

/** Joins, leaves, chat, advancements and voice sessions, newest first. */
export function ActivityFeed({ events }: { events: ServerEvent[] }) {
  return (
    <ul className="grid gap-1 px-5 py-3 text-xs text-muted-foreground">
      {events.length === 0 && <li>No activity yet.</li>}
      {events.map((e) => {
        const Icon = EVENTS[e.kind]?.icon;
        return (
          <li key={`${e.ts}-${e.kind}-${e.player}`}>
            <span className="tabular-nums">{formatWhen(e.ts)}</span> ·{" "}
            {Icon && <Icon className="inline size-3 align-[-2px]" aria-hidden="true" />}{" "}
            {e.player && <PlayerName name={e.player} className="text-foreground" />}{" "}
            {(EVENTS[e.kind]?.describe ?? ((ev) => ev.text))(e)}
          </li>
        );
      })}
    </ul>
  );
}
