import { cn } from "@warden/ui/lib/utils";

/** "Label + hint on the left, control on the right" row used by settings-style lists (Beacon's SettingRow). */
export function FormRow({
  label,
  hint,
  mono,
  children,
}: {
  label: string;
  hint?: string;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <div className="font-medium text-sm">{label}</div>
        {hint && <div className={cn("text-muted-foreground text-xs", mono && "font-mono")}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}
