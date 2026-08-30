"use client";

import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@warden/ui/components/dialog";
import { Input } from "@warden/ui/components/input";
import { badgeTone } from "@warden/ui/lib/badge-tone";
import { BookOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { hasPlugins } from "@/lib/api";
import { COMMAND_GROUPS, type CommandTemplate, isPaperTemplate } from "@/lib/command-templates";
import { mono } from "@/lib/utils";

/**
 * Cheat sheet behind a button next to the console input. Picking a template never runs it: the
 * command lands in the input to be reviewed and sent (multi-command templates are queued one by one).
 */
export function CommandTemplates({ software, onPick }: { software: string; onPick: (commands: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const paper = hasPlugins(software);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (t: CommandTemplate) =>
      (paper || !isPaperTemplate(t)) &&
      (!q || [t.title, t.description, ...t.commands].some((s) => s.toLowerCase().includes(q)));
    return COMMAND_GROUPS.map((g) => ({ ...g, templates: g.templates.filter(matches) })).filter(
      (g) => g.templates.length,
    );
  }, [query, paper]);

  function pick(t: CommandTemplate) {
    onPick(t.commands);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" size="icon" title="Command templates" />}>
        <BookOpen />
        <span className="sr-only">Command templates</span>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Command templates</DialogTitle>
          <DialogDescription>
            Common admin commands. Pick one to put it in the console input; nothing runs until you send it.
          </DialogDescription>
        </DialogHeader>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter…" type="search" autoFocus />
        <div className="-mx-2 min-h-0 overflow-y-auto px-2">
          {groups.length === 0 && <p className="py-3 text-sm text-muted-foreground">No template matches.</p>}
          {groups.map((g) => (
            <div key={g.title} className="grid gap-0.5 py-2">
              <div className="px-2 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                {g.title}
              </div>
              {g.templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pick(t)}
                  className="grid gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {t.title}
                    {isPaperTemplate(t) && (
                      <Badge variant="outline" className={badgeTone.blue}>
                        Paper
                      </Badge>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{t.description}</span>
                  <span className={`grid gap-0.5 text-xs text-muted-foreground ${mono}`}>
                    {t.commands.map((c) => (
                      <code key={c}>/{c}</code>
                    ))}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
