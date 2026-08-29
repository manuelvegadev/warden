import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import { Card } from "@warden/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@warden/ui/components/table";
import { BACKUP_KIND, tone } from "../data";
import type { Simulator } from "../simulator";

export function BackupsSection({ sim }: { sim: Simulator }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-[15px]">
          Backups <span className="font-normal text-muted-foreground">· nightly 03:00 · keep 7</span>
        </div>
        <Button size="sm" onClick={sim.backupNow}>
          Back up now
        </Button>
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Archive</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sim.s.backups.map((b) => (
              <TableRow key={b.name}>
                <TableCell className="font-mono">{b.name}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{b.size}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={BACKUP_KIND[b.kind] ? tone[BACKUP_KIND[b.kind] || "muted"] : undefined}
                  >
                    {b.kind}
                  </Badge>
                </TableCell>
                <TableCell className="text-right text-muted-foreground text-xs">Restore · Download</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
