"use client";

import { Button } from "@warden/ui/components/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@warden/ui/components/dialog";
import { Input } from "@warden/ui/components/input";
import { Label } from "@warden/ui/components/label";
import { Progress } from "@warden/ui/components/progress";
import { Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { useInstance } from "@/components/instance/instance-context";
import { SettingRow } from "@/components/instance/section-card";
import { useAction } from "@/hooks/use-action";
import { can } from "@/lib/access";
import { type LodInfo, lod } from "@/lib/api";
import { pregenFor, pregenSummary, radiusBlocks } from "@/lib/lod";

/** One row per world: its pre-generation's progress with Stop, or Pre-generate. */
export function PregenList({ info, onChange }: { info: LodInfo; onChange: () => void }) {
  const { manifest, status, role } = useInstance();
  const act = useAction(onChange);
  const [dialog, setDialog] = useState<string | null>(null);
  const allowed = can(role, "settings.write");
  const running = status.state === "running";

  return (
    <>
      {info.worlds.map((world) => {
        const p = pregenFor(info, world);
        return (
          <SettingRow
            key={world}
            label={world}
            description={p ? pregenSummary(p.status) : "Pre-generation"}
            stack={!!p}
            trailing={
              allowed &&
              (p ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act(() => lod.stopPregen(manifest.id, world).then(() => "Stopped"))}
                >
                  <Square className="size-4" /> Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!running || !info.agentRuns}
                  title={
                    !running
                      ? "Start the server first"
                      : !info.agentRuns
                        ? "Needs the Warden Agent, which is not connected"
                        : undefined
                  }
                  onClick={() => setDialog(world)}
                >
                  <Play className="size-4" /> Pre-generate
                </Button>
              ))
            }
          >
            {p && p.status.state !== "unknown" && <Progress value={p.status.progress} className="h-1.5" />}
            {p?.status.state === "unknown" && p.status.raw && (
              <details className="text-xs text-muted-foreground">
                <summary>Reply</summary>
                <pre className="whitespace-pre-wrap">{p.status.raw.join("\n")}</pre>
              </details>
            )}
          </SettingRow>
        );
      })}
      <PregenDialog
        world={dialog}
        onClose={() => setDialog(null)}
        onStart={(p) =>
          act(async () => {
            await lod.startPregen(manifest.id, p);
            setDialog(null);
            return `Pre-generating ${p.world}…`;
          })
        }
      />
    </>
  );
}

function PregenDialog({
  world,
  onClose,
  onStart,
}: {
  world: string | null;
  onClose: () => void;
  onStart: (p: { world: string; x?: number; z?: number; radius?: number }) => void;
}) {
  const [x, setX] = useState("");
  const [z, setZ] = useState("");
  const [radius, setRadius] = useState("");
  // Each opening starts empty: what was typed for one world is not another's.
  useEffect(() => {
    if (world === null) return;
    setX("");
    setZ("");
    setRadius("");
  }, [world]);
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const r = num(radius);
  const centreGiven = x.trim() !== "" && z.trim() !== "";
  const centrePairOk = (x.trim() === "") === (z.trim() === "");
  // DHS's pregen start takes positional [world] [x z] [radius]: a radius needs the centre too.
  const radiusNeedsCentre = radius.trim() !== "" && !centreGiven;
  const valid = centrePairOk && !radiusNeedsCentre && (r === undefined || (Number.isInteger(r) && r >= 1 && r <= 4096));
  return (
    <Dialog open={world !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Pre-generate LODs · {world}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="pregen-x">Center X</Label>
              <Input
                id="pregen-x"
                inputMode="numeric"
                placeholder="world border"
                value={x}
                onChange={(e) => setX(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="pregen-z">Center Z</Label>
              <Input
                id="pregen-z"
                inputMode="numeric"
                placeholder="world border"
                value={z}
                onChange={(e) => setZ(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pregen-r">Radius (chunks)</Label>
            <Input id="pregen-r" inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)} />
            {r !== undefined && Number.isInteger(r) && (
              <p className="text-xs text-muted-foreground">≈ {radiusBlocks(r).toLocaleString("en-US")} blocks</p>
            )}
            {radiusNeedsCentre && (
              <p className="text-xs text-destructive">
                Give the centre too, or leave all three empty to use the world border
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Skips what already exists, and resumes after a restart.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || world === null}
            onClick={() => world && onStart({ world, x: num(x), z: num(z), radius: r })}
          >
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
