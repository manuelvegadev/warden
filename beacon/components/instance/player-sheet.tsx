"use client";

import { Award, Ban, Crown, MessageSquare, UserX } from "lucide-react";
import dynamic from "next/dynamic";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { PlayerFace } from "@/components/instance/player-face";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction } from "@/hooks/use-action";
import {
  type Advancement,
  type Counter,
  instances,
  type Player,
  type PlayerActionKind,
  type PlayerSession,
  type PlayerStats,
  skins,
  type TopCategory,
} from "@/lib/api";
import { badgeTone, formatDateTime, formatDuration, mono } from "@/lib/utils";

// three.js is heavy; load the 3D viewer only when a player card opens.
const SkinViewer3D = dynamic(() => import("./skin-viewer").then((m) => m.SkinViewer3D), { ssr: false });

/** "minecraft:diamond_ore" → "Diamond Ore"; "minecraft:story/mine_stone" → "Mine Stone". */
const prettyId = (id: string) =>
  id
    .replace(/^minecraft:/, "")
    .split("/")
    .at(-1)
    ?.split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") ?? id;

const advCategory = (id: string) => id.replace(/^minecraft:/, "").split("/")[0];

const TOP_LABELS: Record<TopCategory, string> = {
  mined: "Blocks mined",
  killed: "Mobs killed",
  killed_by: "Killed by",
  crafted: "Items crafted",
  used: "Items used",
  broken: "Tools broken",
  picked_up: "Items picked up",
};

/**
 * Player card: sessions, statistics and advancements read from the world, plus moderation
 * actions (message, kick, op/deop, ban). Opened from the players table.
 */
export function PlayerSheet({
  instanceId,
  player,
  online,
  isAdmin,
  onClose,
  onChanged,
}: {
  instanceId: string;
  player: Player | null;
  online: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [sessions, setSessions] = useState<PlayerSession[] | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [advancements, setAdvancements] = useState<Advancement[] | null>(null);
  const [prompt, setPrompt] = useState<"message" | "kick" | "ban" | null>(null);
  const name = player?.name;

  useEffect(() => {
    if (!name) return;
    let stale = false;
    setSessions(null);
    setStats(null);
    setAdvancements(null);
    const guard =
      <T,>(set: (v: T) => void) =>
      (v: T) => {
        if (!stale) set(v);
      };
    instances
      .sessions(instanceId, name)
      .then(guard(setSessions))
      .catch(() => {});
    instances
      .playerStats(instanceId, name)
      .then(guard(setStats))
      .catch((e) => toast.error(e.message));
    instances
      .playerAdvancements(instanceId, name)
      .then(guard(setAdvancements))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [instanceId, name]);

  const run = useAction(onChanged);
  const act = (action: PlayerActionKind, text?: string) =>
    name &&
    run(() =>
      instances
        .playerAction(instanceId, name, action, text)
        .then(() => ({ message: `Sent to ${name}`, kick: `Kicked ${name}` })[action]),
    );
  const setOp = (op: boolean) =>
    name &&
    run(() =>
      (op ? instances.opAdd(instanceId, name, 4) : instances.opRemove(instanceId, name)).then(
        () => `${name} is ${op ? "now" : "no longer"} an operator`,
      ),
    );
  const ban = async (reason: string) => {
    if (name && (await run(() => instances.ban(instanceId, name, reason || undefined).then(() => `Banned ${name}`)))) {
      onClose();
    }
  };

  const done = advancements?.filter((a) => a.done) ?? [];

  return (
    <Sheet open={player !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-xl">
        {player && (
          <>
            <SheetHeader className="border-b p-5">
              <SheetTitle className="flex items-center gap-3">
                <PlayerFace name={player.name} className="size-10" />
                {player.name}
                {online && (
                  <Badge variant="outline" className={badgeTone.emerald}>
                    online
                  </Badge>
                )}
              </SheetTitle>
              <SheetDescription>
                {formatDuration(stats?.playTimeSeconds ?? player.playTimeSeconds)} played · first seen{" "}
                {formatDateTime(player.firstSeen)} · last seen {formatDateTime(player.lastSeen)}
              </SheetDescription>
              {isAdmin && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={!online} onClick={() => setPrompt("message")}>
                    <MessageSquare className="size-4" /> Message
                  </Button>
                  <Button size="sm" variant="outline" disabled={!online} onClick={() => setPrompt("kick")}>
                    <UserX className="size-4" /> Kick
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setOp(true)}>
                    <Crown className="size-4" /> Op
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setOp(false)}>
                    Deop
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => setPrompt("ban")}>
                    <Ban className="size-4" /> Ban
                  </Button>
                </div>
              )}
            </SheetHeader>

            <Tabs defaultValue="stats" className="gap-0">
              <TabsList className="mx-5 mt-4">
                <TabsTrigger value="skin">Skin</TabsTrigger>
                <TabsTrigger value="stats">Statistics</TabsTrigger>
                <TabsTrigger value="advancements">Advancements{advancements ? ` (${done.length})` : ""}</TabsTrigger>
                <TabsTrigger value="sessions">Sessions</TabsTrigger>
              </TabsList>

              <TabsContent value="skin" className="p-5">
                <div className="rounded-md border bg-muted/30 py-4">
                  <SkinViewer3D skinUrl={skins.full(player.name)} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Skin of the Mojang account named {player.name}; offline-mode players may look different in-game.
                </p>
              </TabsContent>

              <TabsContent value="stats" className="p-5">
                {stats === null ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : stats.dataVersion === 0 ? (
                  <p className="text-sm text-muted-foreground">No statistics recorded for this player yet.</p>
                ) : (
                  <StatsView stats={stats} />
                )}
              </TabsContent>

              <TabsContent value="advancements" className="p-5">
                {advancements === null && <p className="text-sm text-muted-foreground">Loading…</p>}
                {advancements?.length === 0 && (
                  <p className="text-sm text-muted-foreground">No advancements recorded for this player yet.</p>
                )}
                {advancements && advancements.length > 0 && (
                  <ul className="divide-y rounded-md border">
                    {advancements.map((a) => (
                      <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <Award
                          className={`size-4 shrink-0 ${a.done ? "text-amber-500" : "text-muted-foreground/50"}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={a.done ? "font-medium" : "text-muted-foreground"}>{prettyId(a.id)}</span>
                            <Badge variant="secondary" className="capitalize">
                              {advCategory(a.id)}
                            </Badge>
                            {!a.done && <span className="text-xs text-muted-foreground">in progress</span>}
                          </div>
                          {a.at && <p className="text-xs text-muted-foreground">{formatDateTime(a.at)}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="sessions" className="p-5">
                {sessions === null && <p className="text-sm text-muted-foreground">Loading…</p>}
                {sessions?.length === 0 && <p className="text-sm text-muted-foreground">No sessions recorded.</p>}
                {sessions && sessions.length > 0 && (
                  <ul className="divide-y rounded-md border text-sm">
                    {sessions.map((s) => (
                      <li key={s.joinedAt} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span>
                          {formatDateTime(s.joinedAt)} → {s.leftAt ? formatDateTime(s.leftAt) : "now"}
                        </span>
                        <span className={`${mono} text-xs text-muted-foreground`}>
                          {formatDuration(
                            ((s.leftAt ? new Date(s.leftAt).getTime() : Date.now()) - new Date(s.joinedAt).getTime()) /
                              1000,
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>

      <TextPrompt
        key={prompt ?? "none"} // remount per prompt so the field starts empty
        kind={prompt}
        name={name ?? ""}
        onClose={() => setPrompt(null)}
        onSubmit={(text) => {
          setPrompt(null);
          if (prompt === "ban") ban(text);
          else if (prompt) act(prompt, text);
        }}
      />
    </Sheet>
  );
}

function StatsView({ stats }: { stats: PlayerStats }) {
  const tiles: [string, string][] = [
    ["Play time", formatDuration(stats.playTimeSeconds)],
    ["Deaths", String(stats.deaths)],
    ["Mob kills", String(stats.mobKills)],
    ["Player kills", String(stats.playerKills)],
    [
      "Distance",
      stats.distanceMeters >= 1000
        ? `${(stats.distanceMeters / 1000).toFixed(1)} km`
        : `${Math.round(stats.distanceMeters)} m`,
    ],
    ["Jumps", String(stats.jumps)],
    ["Damage dealt", `${stats.damageDealt.toFixed(0)} ♥`],
    ["Damage taken", `${stats.damageTaken.toFixed(0)} ♥`],
    ["Blocks mined", String(stats.blocksMined)],
    ["Items crafted", String(stats.itemsCrafted)],
  ];
  const lists = (Object.keys(TOP_LABELS) as TopCategory[])
    .map((cat) => [cat, stats.top[cat] ?? []] as const)
    .filter(([, items]) => items.length > 0);
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-md border px-3 py-2">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`${mono} text-sm font-semibold`}>{value}</p>
          </div>
        ))}
      </div>
      {lists.map(([cat, items]) => (
        <TopList key={cat} title={TOP_LABELS[cat]} items={items} />
      ))}
    </div>
  );
}

function TopList({ title, items }: { title: string; items: Counter[] }) {
  const max = items[0]?.count ?? 1;
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="grid gap-1">
        {items.map((c) => (
          <li key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
            <div className="relative overflow-hidden rounded-sm">
              <div className="absolute inset-y-0 left-0 bg-primary/10" style={{ width: `${(c.count / max) * 100}%` }} />
              <span className="relative px-2 py-0.5">{prettyId(c.id)}</span>
            </div>
            <span className={`${mono} text-xs text-muted-foreground`}>{c.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Message / kick reason / ban reason prompt. */
function TextPrompt({
  kind,
  name,
  onClose,
  onSubmit,
}: {
  kind: "message" | "kick" | "ban" | null;
  name: string;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const copy = {
    message: { title: `Message ${name}`, body: "Sent privately with /tell.", label: "Message", cta: "Send" },
    kick: {
      title: `Kick ${name}?`,
      body: "Disconnects the player; they can rejoin.",
      label: "Reason (optional)",
      cta: "Kick",
    },
    ban: {
      title: `Ban ${name}?`,
      body: "Adds the player to banned-players.json and kicks them if online.",
      label: "Reason (optional)",
      cta: "Ban",
    },
  }[kind ?? "message"];
  function submit(e: FormEvent) {
    e.preventDefault();
    if (kind === "message" && !text.trim()) return;
    onSubmit(text.trim());
  }
  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.body}</DialogDescription>
          </DialogHeader>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={copy.label} autoFocus />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={kind === "ban" ? "destructive" : "default"}>
              {copy.cta}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
