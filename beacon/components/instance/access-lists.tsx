"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SectionCard, StatusHint } from "@/components/instance/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type BanEntry, instances, type OpEntry, type WhitelistEntry } from "@/lib/api";
import { mono } from "@/lib/utils";

type Kind = "whitelist" | "ops" | "bans";

/** Whitelist, operators and bans. Commands go through the live server when running, JSON files otherwise. */
export function AccessLists({ id, isAdmin }: { id: string; isAdmin: boolean }) {
  const [whitelist, setWhitelist] = useState<WhitelistEntry[]>([]);
  const [ops, setOps] = useState<OpEntry[]>([]);
  const [bans, setBans] = useState<{ players: BanEntry[]; ips: BanEntry[] }>({ players: [], ips: [] });
  const [props, setProps] = useState<Record<string, string>>({});
  const [openForm, setOpenForm] = useState<Kind | null>(null);

  // Only the list that changed is re-read; the live server writes its JSON shortly after a command.
  const refresh = useCallback(
    (kind?: Kind) => {
      const jobs: Promise<unknown>[] = [];
      if (!kind || kind === "whitelist") jobs.push(instances.whitelist(id).then(setWhitelist));
      if (!kind || kind === "ops") jobs.push(instances.ops(id).then(setOps));
      if (!kind || kind === "bans") jobs.push(instances.bans(id).then(setBans));
      Promise.all(jobs).catch((e) => toast.error(e.message));
    },
    [id],
  );

  useEffect(() => {
    refresh();
    instances
      .properties(id)
      .then((p) => setProps(Object.fromEntries(p.map((x) => [x.key, x.value]))))
      .catch(() => {});
  }, [id, refresh]);

  const run = async (kind: Kind, label: string, fn: () => Promise<void>) => {
    try {
      await fn();
      setTimeout(() => refresh(kind), 600);
    } catch (e) {
      toast.error(`${label}: ${e instanceof Error ? e.message : "failed"}`);
      throw e;
    }
  };

  const submit = (handler: (fd: FormData) => Promise<void>, close: () => void) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    void handler(new FormData(form))
      .then(() => {
        form.reset();
        close();
      })
      .catch(() => {});
  };

  const whitelistOn = props["white-list"] === "true";
  const enforce = props["enforce-whitelist"] === "true";
  const onlineMode = props["online-mode"] !== "false";
  const byName = (e: { uuid?: string; name?: string }) => e.uuid || e.name || "";
  const close = () => setOpenForm(null);
  const toggle = (kind: Kind, label: string, variant: "outline" | "destructive" = "outline") => (
    <Button
      size="sm"
      variant={openForm === kind ? "ghost" : variant}
      onClick={() => setOpenForm(openForm === kind ? null : kind)}
    >
      {openForm === kind ? "Cancel" : label}
    </Button>
  );

  return (
    <div className="grid gap-8">
      <SectionCard
        title="Whitelist"
        subtitle="Only these players can join when white-list is enabled."
        status={
          <>
            {!whitelistOn && (
              <StatusHint label="Not enforced" title="Whitelist is disabled">
                Anyone can join and this list has no effect while <code className="inline">white-list</code> is off.
                Enable it in Properties → Common → white-list.
              </StatusHint>
            )}
            {whitelistOn && !enforce && (
              <StatusHint label="No kick on removal" title="Removals are not enforced" tone="muted">
                Players removed from the list stay connected until they leave, because{" "}
                <code className="inline">enforce-whitelist</code> is off. Enable it in Properties → Players.
              </StatusHint>
            )}
          </>
        }
        action={toggle("whitelist", "Add player")}
        topRow={
          openForm === "whitelist" && (
            <form
              onSubmit={submit(
                (fd) => run("whitelist", "Whitelist", () => instances.whitelistAdd(id, String(fd.get("name")))),
                close,
              )}
              className="flex gap-2 bg-muted/30 px-5 py-3"
            >
              <NameInput />
              <Button type="submit" variant="outline">
                Add
              </Button>
            </form>
          )
        }
      >
        <List
          empty="Nobody whitelisted."
          items={whitelist.map((w) => ({
            key: byName(w),
            label: w.name,
            hint: w.uuid,
            onRemove: () => run("whitelist", "Whitelist", () => instances.whitelistRemove(id, w.name)),
          }))}
        />
      </SectionCard>

      <SectionCard
        title="Operators"
        subtitle="Players with admin commands. Levels only apply while the server is stopped."
        action={isAdmin && toggle("ops", "Op player")}
        topRow={
          openForm === "ops" && (
            <form
              onSubmit={submit(
                (fd) => run("ops", "Op", () => instances.opAdd(id, String(fd.get("name")), Number(fd.get("level")))),
                close,
              )}
              className="flex gap-2 bg-muted/30 px-5 py-3"
            >
              <NameInput />
              <Select name="level" defaultValue="4">
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((l) => (
                    <SelectItem key={l} value={String(l)}>
                      Level {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" variant="outline">
                Op
              </Button>
            </form>
          )
        }
      >
        <List
          empty="No operators."
          items={ops.map((o) => ({
            key: byName(o),
            label: o.name,
            badge: `level ${o.level}`,
            hint: o.uuid,
            onRemove: isAdmin ? () => run("ops", "Deop", () => instances.opRemove(id, o.name)) : undefined,
          }))}
        />
      </SectionCard>

      <SectionCard
        title="Bans"
        subtitle="Banned players and IP addresses."
        status={
          !onlineMode && (
            <StatusHint label="Online mode off" title="Name bans can be bypassed">
              Accounts are not verified while <code className="inline">online-mode</code> is false, so anyone can join
              using a banned player's name; only IP bans are reliable. Enable it in Properties → Common → online-mode.
            </StatusHint>
          )
        }
        action={toggle("bans", "Ban player or IP", "destructive")}
        topRow={
          openForm === "bans" && (
            <form
              onSubmit={submit(
                (fd) =>
                  run("bans", "Ban", () =>
                    instances.ban(id, String(fd.get("target")).trim(), String(fd.get("reason"))),
                  ),
                close,
              )}
              className="flex flex-wrap gap-2 bg-muted/30 px-5 py-3"
            >
              <Input name="target" placeholder="Player name or IP" required autoFocus className={`max-w-xs ${mono}`} />
              <Input name="reason" placeholder="Reason (optional)" className="max-w-sm flex-1" />
              <Button type="submit" variant="destructive">
                Ban
              </Button>
            </form>
          )
        }
      >
        <List
          empty="No bans."
          removeLabel="Pardon"
          items={[
            ...bans.players.map((b) => ({
              key: `p-${byName(b)}`,
              label: b.name ?? "",
              hint: banHint(b),
              onRemove: () => run("bans", "Pardon", () => instances.pardon(id, b.name ?? "")),
            })),
            ...bans.ips.map((b) => ({
              key: `ip-${b.ip}`,
              label: b.ip ?? "",
              badge: "ip",
              hint: banHint(b),
              onRemove: () => run("bans", "Pardon", () => instances.pardon(id, b.ip ?? "")),
            })),
          ]}
        />
      </SectionCard>
    </div>
  );
}

const banHint = (b: BanEntry) => `${b.reason} · by ${b.source} · ${b.created}`;

function NameInput() {
  return (
    <Input
      name="name"
      placeholder="Player name"
      required
      autoFocus
      pattern="[A-Za-z0-9_]{1,16}"
      className={`max-w-xs ${mono}`}
    />
  );
}

function List({
  items,
  empty,
  removeLabel = "Remove",
}: {
  items: { key: string; label: string; badge?: string; hint?: string; onRemove?: () => void }[];
  empty: string;
  removeLabel?: string;
}) {
  if (items.length === 0) return <p className="px-5 py-3 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y">
      {items.map((it) => (
        <li key={it.key} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
          <div className="min-w-0">
            <span className={mono}>{it.label}</span> {it.badge && <Badge variant="secondary">{it.badge}</Badge>}
            {it.hint && <div className="truncate text-xs text-muted-foreground">{it.hint}</div>}
          </div>
          {it.onRemove && (
            <Button size="sm" variant="ghost" onClick={it.onRemove}>
              {removeLabel}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
