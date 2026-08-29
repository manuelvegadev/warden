import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import { VERSION } from "@/lib/links";

/** Hero copy; the interactive demo is passed in as the island (see index.astro). */
export function Hero({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden px-6 pt-16 pb-8 md:px-20 md:pt-[72px]">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-[200px] left-1/2 h-[600px] w-[1200px] -translate-x-1/2 animate-pulse opacity-40"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(59,130,246,0.20), rgba(139,92,246,0.08) 45%, transparent 70%)",
          animationDuration: "7s",
        }}
      />
      <div className="relative mx-auto flex max-w-[900px] flex-col items-center gap-[18px] text-center">
        <Badge variant="outline" className="bg-foreground/4">
          {VERSION} · Paper, Purpur, Fabric, Vanilla
        </Badge>
        <h1 className="text-balance font-semibold text-4xl leading-none tracking-[-0.035em] md:text-6xl">
          A modern control plane for Minecraft servers. Fast, live, designed.
        </h1>
        <p className="max-w-[620px] text-pretty text-lg text-muted-foreground leading-normal">
          Warden is written in Go: one binary that supervises every server on the box and streams console, metrics and
          events over WebSocket to Beacon, the panel below — open on a running server. Click around.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button size="lg" render={<a href="#install" />}>
            Get started
          </Button>
        </div>
      </div>
      <div className="relative mt-9">{children}</div>
    </section>
  );
}
