import { Card, CardContent } from "@warden/ui/components/card";
import { Input } from "@warden/ui/components/input";
import { Switch } from "@warden/ui/components/switch";
import { FormRow } from "../form-row";
import type { Simulator } from "../simulator";

export function SettingsSection({ sim }: { sim: Simulator }) {
  return (
    <Card className="py-0">
      <CardContent className="divide-y px-0">
        <FormRow label="Memory" hint="Xms = Xmx">
          <Input readOnly value={`${sim.inst.memoryMb} MB`} className="w-40 font-mono" />
        </FormRow>
        <FormRow label="JVM preset" hint="Aikar's flags">
          <Input readOnly value="Aikar" className="w-40" />
        </FormRow>
        <FormRow label="Restart on crash" hint="exponential backoff">
          <Switch checked readOnly />
        </FormRow>
        <FormRow label="Autostart" hint="with wardend">
          <Switch checked readOnly />
        </FormRow>
        <FormRow label="Stop timeout" hint="grace before SIGKILL">
          <Input readOnly value="30 s" className="w-40 font-mono" />
        </FormRow>
      </CardContent>
    </Card>
  );
}
