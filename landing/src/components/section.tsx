import { cn } from "@warden/ui/lib/utils";

/** Page gutters and max width, shared by the nav, the footer and every section. */
export const CONTAINER = "mx-auto w-full max-w-7xl px-6 md:px-10 lg:px-20";

/** Section shell: gutters, max width and the 112px vertical rhythm shared by every block. */
export function Section({ id, className, children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={cn(CONTAINER, "py-28", className)}>
      {children}
    </section>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">{children}</div>;
}

export function Heading({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <h2 className={cn("text-3xl font-semibold leading-[1.1] tracking-[-0.025em] md:text-4xl", className)}>
      {children}
    </h2>
  );
}
