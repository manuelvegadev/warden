"use client";

import { Badge } from "@warden/ui/components/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@warden/ui/components/table";
import { badgeTone } from "@warden/ui/lib/badge-tone";
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
      .events(id, ["player.join", "player.leave", "player.advancement", "player.chat"], 50)
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
      <SectionCard title="Recent activity" subtitle="Joins, leaves, chat and advancements.">
        <ul className="grid gap-1 px-5 py-3 text-xs text-muted-foreground">
          {events.length === 0 && <li>No activity yet.</li>}
          {events.map((e) => (
            <li key={`${e.ts}-${e.kind}-${e.player}`}>
              <span className="tabular-nums">{new Date(e.ts).toLocaleTimeString()}</span> ·{" "}
              <span className="text-foreground">{e.player}</span> {describe(e)}
            </li>
          ))}
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

function describe(e: ServerEvent) {
  switch (e.kind) {
    case "player.join":
      return "joined";
    case "player.leave":
      return "left";
    case "player.advancement":
      return `earned “${e.text}”`;
    case "player.chat":
      return `said “${e.text}”`;
    default:
      return e.text;
  }
}
