import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import { Card, CardContent } from "@warden/ui/components/card";
import { ExternalLink } from "lucide-react";
import { Eyebrow, Heading, Section } from "@/components/section";
import { LINKS } from "@/lib/links";

function Snippet({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-[#1c1c1c] px-3 py-2.5 font-mono text-xs leading-7 text-[#d4d4d4] ring-1 ring-foreground/10">
      {children}
    </div>
  );
}

const DOC_LINKS = [
  { href: LINKS.architecture, label: "Architecture docs" },
  { href: LINKS.adrs, label: "ADRs" },
  { href: LINKS.api, label: "API spec" },
];

export function UnderTheHood() {
  return (
    <Section className="flex flex-col gap-10">
      <div className="flex max-w-3xl flex-col gap-2.5">
        <Eyebrow>Under the hood</Eyebrow>
        <Heading>Built in Go, on the metal, with the panel wherever it fits.</Heading>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="py-0">
          <CardContent className="flex flex-col gap-3 p-6">
            <div className="font-mono text-xs text-muted-foreground">wardend · Go 1.25</div>
            <div className="text-xl font-semibold tracking-[-0.01em]">One static binary, no runtime to install.</div>
            <p className="text-pretty text-[15px] leading-relaxed text-muted-foreground">
              The daemon is a single Go executable with an embedded scheduler, SQLite store and TLS. It starts in
              milliseconds, idles at a few MB of RAM and leaves the CPU and memory of the machine to the servers
              themselves.
            </p>
            <Snippet>
              $ ls -la wardend <span className="text-muted-foreground"># example</span>
              <br />
              <span className="text-muted-foreground">-rwxr-xr-x 1 warden warden 19M wardend</span>
            </Snippet>
          </CardContent>
        </Card>
        <Card className="py-0">
          <CardContent className="flex flex-col gap-3 p-6">
            <div className="font-mono text-xs text-muted-foreground">transport · WebSocket + REST</div>
            <div className="text-xl font-semibold tracking-[-0.01em]">Live by default.</div>
            <p className="text-pretty text-[15px] leading-relaxed text-muted-foreground">
              Console lines, state changes, metrics samples and task progress are pushed over a single authenticated
              WebSocket the moment they happen. REST covers the rest. No polling loops, no page refreshes.
            </p>
            <Snippet>
              <span className="text-muted-foreground">ws ›</span> console · state · events
              <br />
              <span className="text-muted-foreground">ws ›</span> metrics (2 s) · tasks
              <br />
              <span className="text-muted-foreground">jwt</span> first message · Ed25519
            </Snippet>
          </CardContent>
        </Card>
        <Card className="py-0">
          <CardContent className="flex flex-col gap-3 p-6">
            <div className="font-mono text-xs text-muted-foreground">beacon · Next.js, separate service</div>
            <div className="text-xl font-semibold tracking-[-0.01em]">The panel is its own deployable.</div>
            <p className="text-pretty text-[15px] leading-relaxed text-muted-foreground">
              Beacon only signs you in and serves the UI; the browser talks to wardend directly. Run it as a container
              next to the daemon (the installer offers it) or on a separate host or Dokploy, depending on how many nodes
              you manage.
            </p>
            <div className="flex flex-wrap gap-2">
              {["same box · Docker", "separate host", "Dokploy", "PWA"].map((t) => (
                <Badge key={t} variant="outline">
                  {t}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-wrap gap-3">
        {DOC_LINKS.map((l) => (
          <Button key={l.label} variant="outline" render={<a href={l.href} target="_blank" rel="noreferrer" />}>
            {l.label}
            <ExternalLink data-icon="inline-end" />
          </Button>
        ))}
      </div>
    </Section>
  );
}
