"use client";

import { Button } from "@warden/ui/components/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@warden/ui/components/combobox";
import { Input } from "@warden/ui/components/input";
import { PencilLine } from "lucide-react";
import { useState } from "react";
import { PlayerFace } from "@/components/instance/player-face";
import { useKnownPlayers } from "@/hooks/use-known-players";
import { mono } from "@/lib/utils";

/** Sentinel item that switches the picker to free text (a leading space cannot be a player name). */
const OTHER = " other";

/**
 * Form field for a player name: a searchable list of everyone who has joined this instance (most
 * recent first) plus "Other…" for someone who has not — or an IP when `allowIp`. Submits as a normal
 * form field named `name`, so the surrounding form reads it with FormData like before.
 */
export function PlayerPicker({ id, name, allowIp = false }: { id: string; name: string; allowIp?: boolean }) {
  const known = useKnownPlayers(id);
  const [other, setOther] = useState(false);

  if (other) {
    return (
      <div className="flex min-w-0 flex-1 gap-2">
        <Input
          name={name}
          placeholder={allowIp ? "Player name or IP" : "Player name"}
          required
          autoFocus
          pattern={allowIp ? undefined : "[A-Za-z0-9_]{1,16}"}
          className={`max-w-xs ${mono}`}
        />
        <Button type="button" variant="ghost" size="sm" onClick={() => setOther(false)}>
          Pick from list
        </Button>
      </div>
    );
  }

  return (
    <Combobox
      items={[...known, OTHER]}
      name={name}
      required
      itemToStringLabel={(v: string) => (v === OTHER ? "Other…" : v)}
      // "Other…" stays visible whatever is typed.
      filter={(item: string, query: string) => item === OTHER || item.toLowerCase().includes(query.toLowerCase())}
      onValueChange={(v) => v === OTHER && setOther(true)}
    >
      <ComboboxInput placeholder={known.length ? "Search players…" : "Pick a player"} autoFocus className="max-w-xs" />
      <ComboboxContent>
        <ComboboxEmpty>No player has joined yet.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item === OTHER ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <PencilLine className="size-4" /> Other…
                </span>
              ) : (
                <span className={`flex items-center gap-2 ${mono}`}>
                  <PlayerFace name={item} className="size-5" />
                  {item}
                </span>
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
