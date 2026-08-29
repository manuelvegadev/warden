import { cn } from "@warden/ui/lib/utils";

/** Fade-up once when scrolled into view; the observer lives in Layout.astro (see .reveal in global.css). */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div className={cn("reveal", className)} style={delay ? { transitionDelay: `${delay}s` } : undefined}>
      {children}
    </div>
  );
}
