import { Badge } from "@warden/ui/components/badge";
import { Card, CardContent } from "@warden/ui/components/card";
import { Switch } from "@warden/ui/components/switch";
import { tone } from "../data";
import { FormRow } from "../form-row";
import type { Simulator } from "../simulator";

export function PropertiesSection({ sim }: { sim: Simulator }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-end justify-between">
        <div>
          <div className="font-semibold text-[15px]">Gameplay</div>
          <div className="text-muted-foreground text-xs">server.properties</div>
        </div>
        {sim.s.dirty && (
          <Badge variant="outline" className={tone.amber}>
            restart pending
          </Badge>
        )}
      </div>
      <Card className="py-0">
        <CardContent className="divide-y px-0">
          {sim.s.props.map((p, i) => (
            <FormRow key={p.key} label={p.label} hint={p.key} mono>
              <Switch checked={p.on} onCheckedChange={() => sim.flipProp(i)} />
            </FormRow>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
