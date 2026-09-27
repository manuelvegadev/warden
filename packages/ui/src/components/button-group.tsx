import { cn } from "@warden/ui/lib/utils";

/**
 * Buttons joined into one control, shadcn's ButtonGroup: the inner corners squared and the shared
 * borders collapsed, so they read as the segments of a single bar. Elements that render nothing in
 * place (a dialog's portal) do not break the joins.
 */
function ButtonGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="button-group"
      className={cn(
        "flex w-fit items-stretch",
        // Keyboard focus lifts a segment above its neighbours, so its ring is not hidden under them.
        "*:focus-visible:relative *:focus-visible:z-10",
        "[&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none",
        className,
      )}
      {...props}
    />
  );
}

export { ButtonGroup };
