import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import { Card } from "@warden/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@warden/ui/components/table";
import { PluginIcon } from "../avatars";
import { PLUGIN_STATUS, tone } from "../data";
import type { Simulator } from "../simulator";

export function PluginsSection({ sim }: { sim: Simulator }) {
  const installed = sim.s.plugins.filter((p) => p.status === "installed").length;
  const queued = sim.s.plugins.filter((p) => p.status === "queued").length;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-[15px]">
          Plugins <span className="font-normal text-muted-foreground">· {installed} installed</span>
        </div>
        <Button size="sm" onClick={sim.installQueue} disabled={queued === 0}>
          Install queue ({queued})
        </Button>
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plugin</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sim.s.plugins.map((p, i) => (
              <TableRow key={p.name}>
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-2">
                    <PluginIcon name={p.name} />
                    {p.name}
                  </span>
                </TableCell>
                <TableCell className="font-mono">{p.version}</TableCell>
                <TableCell>
                  <Badge variant="outline">{p.source}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={tone[PLUGIN_STATUS[p.status].tone || "muted"]}>
                    {p.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => sim.cyclePlugin(i)}>
                    {PLUGIN_STATUS[p.status].action}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
