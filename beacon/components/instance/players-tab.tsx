"use client";

import { Badge } from "@warden/ui/components/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@warden/ui/components/table";
import { badgeTone } from "@warden/ui/lib/badge-tone";
import { Headphones, type LucideIcon, Mic } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PlayerFace } from "@/components/instance/player-face";
import { PlayerSheet } from "@/components/instance/player-sheet";
import { SectionCard } from "@/components/instance/section-card";
import { instances, type Player, type ServerEvent } from "@/lib/api";
import { formatDateTime, formatDuration } from "@/lib/utils";

/** Player history from the daemon store; `online` comes from the live status so it refreshes on join/leave. */
export function PlayersTab({ id, online, canManage }: { id: string; online: string[]; canManage: boolean }) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const onlineKey = online.join(",");

  const refresh = useCallback(() => {
    instances
      .players(id)
      .then(setPlayers)
      .catch((e) => toast.error(e.message));
    instances
      .events(id, Object.keys(EVENTS), 50)
      .then(setEvents)
      .catch(() => {});
  }, [id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: onlineKey re-fetches history on join/leave
  useEffect(() => {
    refresh();
  }, [refresh, onlineKey]);

  const player = players?.find((p) => p.name === selected) ?? null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <SectionCard title="Players" subtitle="Everyone who has joined. Click a player for statistics and actions.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Player</TableHead>
              <TableHead>Play time</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead className="pr-5">First seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {players?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="pl-5 text-muted-foreground">
                  No player has joined yet.
                </TableCell>
              </TableRow>
            )}
            {players?.map((p) => (
              <TableRow key={p.name} className="cursor-pointer" onClick={() => setSelected(p.name)}>
                <TableCell className="pl-5 font-medium">
                  <div className="flex items-center gap-3">
                    <PlayerFace name={p.name} className="size-7" />
                    {p.name}
                    {online.includes(p.name) && (
                      <Badge variant="outline" className={badgeTone.emerald}>
                        online
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>{formatDuration(p.playTimeSeconds)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDateTime(p.lastSeen)}</TableCell>
                <TableCell className="pr-5 text-muted-foreground">{formatDateTime(p.firstSeen)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
      <SectionCard title="Recent activity" subtitle="Joins, leaves, chat, advancements and voice sessions from Beacon.">
        <ul className="grid gap-1 px-5 py-3 text-xs text-muted-foreground">
          {events.length === 0 && <li>No activity yet.</li>}
          {events.map((e) => {
            const Icon = EVENTS[e.kind]?.icon;
            return (
              <li key={`${e.ts}-${e.kind}-${e.player}`}>
                <span className="tabular-nums">{new Date(e.ts).toLocaleTimeString()}</span> ·{" "}
                {Icon && <Icon className="inline size-3 align-[-2px]" aria-hidden="true" />}{" "}
                <span className="text-foreground">{e.player}</span> {(EVENTS[e.kind]?.describe ?? ((ev) => ev.text))(e)}
              </li>
            );
          })}
        </ul>
      </SectionCard>
      <PlayerSheet
        instanceId={id}
        player={player}
        online={player ? online.includes(player.name) : false}
        canManage={canManage}
        onClose={() => setSelected(null)}
        onChanged={refresh}
      />
    </div>
  );
}

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
