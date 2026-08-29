"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { instances, type Player, type PlayerSession, type ServerEvent } from "@/lib/api";

const fmtDuration = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const fmtTime = (iso: string) => new Date(iso).toLocaleString();

/** Player history from the daemon store; `online` and `version` come from the live status so it refreshes on join/leave. */
export function PlayersTab({ id, online }: { id: string; online: string[] }) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PlayerSession[]>([]);
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

  useEffect(() => {
    if (!selected) return;
    let stale = false;
    instances
      .sessions(id, selected)
      .then((s) => {
        if (!stale) setSessions(s);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [id, selected]);

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <section>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead>Play time</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>First seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {players?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No player has joined yet.
                </TableCell>
              </TableRow>
            )}
            {players?.map((p) => (
              <TableRow key={p.name} className="cursor-pointer" onClick={() => setSelected(p.name)}>
                <TableCell className="font-medium">
                  {p.name}{" "}
                  {online.includes(p.name) && (
                    <Badge variant="outline" className="border-emerald-600/30 bg-emerald-600/15 text-emerald-500">
                      online
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{fmtDuration(p.playTimeSeconds)}</TableCell>
                <TableCell className="text-muted-foreground">{fmtTime(p.lastSeen)}</TableCell>
                <TableCell className="text-muted-foreground">{fmtTime(p.firstSeen)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {selected && (
          <div className="mt-4 rounded-md border p-3 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">Sessions · {selected}</span>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
            <ul className="grid gap-1 text-muted-foreground">
              {sessions.map((s) => (
                <li key={s.joinedAt}>
                  {fmtTime(s.joinedAt)} → {s.leftAt ? fmtTime(s.leftAt) : "now"}
                </li>
              ))}
              {sessions.length === 0 && <li>No sessions recorded.</li>}
            </ul>
          </div>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-medium">Recent activity</h3>
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {events.length === 0 && <li>No activity yet.</li>}
          {events.map((e) => (
            <li key={`${e.ts}-${e.kind}-${e.player}`}>
              <span className="tabular-nums">{new Date(e.ts).toLocaleTimeString()}</span> ·{" "}
              <span className="text-foreground">{e.player}</span> {describe(e)}
            </li>
          ))}
        </ul>
      </section>
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
