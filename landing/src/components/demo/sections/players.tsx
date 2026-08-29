import { Badge } from "@warden/ui/components/badge";
import { Card } from "@warden/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@warden/ui/components/table";
import { PlayerFace } from "../avatars";
import { PLAYERS, tone } from "../data";
import type { Simulator } from "../simulator";

export function PlayersSection({ sim }: { sim: Simulator }) {
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Player</TableHead>
            <TableHead>Play time</TableHead>
            <TableHead>Sessions</TableHead>
            <TableHead>Last seen</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {PLAYERS.map((p) => {
            const on = sim.joined.includes(p.name);
            return (
              <TableRow key={p.name}>
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-2">
                    <PlayerFace name={p.name} />
                    {p.name}
                  </span>
                </TableCell>
                <TableCell className="font-mono tabular-nums">{p.time}</TableCell>
                <TableCell className="font-mono tabular-nums">{p.sessions}</TableCell>
                <TableCell className="text-muted-foreground">{on ? "now" : "3 d ago"}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={on ? tone.emerald : tone.muted}>
                    {on ? "online" : "offline"}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
