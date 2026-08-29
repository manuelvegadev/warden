import { Button } from "@warden/ui/components/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@warden/ui/components/tabs";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Eyebrow, Heading, Section } from "@/components/section";
import { INSTALL_OPTIONS, LINKS } from "@/lib/links";

function CommandBlock({ commands, label }: { commands: readonly string[]; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(commands.filter((c) => !c.startsWith("#")).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (insecure context): the commands stay selectable.
    }
  };
  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-[#1c1c1c] text-left ring-1 ring-foreground/10">
      <pre className="whitespace-pre-wrap break-all px-5 py-4 pr-14 font-mono text-[13.5px] leading-7 text-[#d4d4d4]">
        {commands.map((c) => (
          <span key={c} className={c.startsWith("#") ? "text-muted-foreground" : undefined}>
            {c}
            {"\n"}
          </span>
        ))}
      </pre>
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-3 right-3 text-muted-foreground"
        onClick={copy}
        aria-label={`Copy commands: ${label}`}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

export function Install() {
  return (
    <Section id="install" className="flex flex-col items-center gap-5 border-t text-center">
      <Eyebrow>Install</Eyebrow>
      <Heading>One line on a fresh Ubuntu box.</Heading>
      <p className="max-w-xl text-pretty text-muted-foreground">
        The script downloads the latest release for your CPU, verifies its checksum and hands over to{" "}
        <code className="font-mono text-sm">wardend install</code>, which writes the systemd unit and picks a TLS mode.
        Pick where the panel lives:
      </p>
      <Tabs defaultValue={INSTALL_OPTIONS[0].id} className="w-full max-w-3xl items-center gap-4">
        <TabsList>
          {INSTALL_OPTIONS.map((o) => (
            <TabsTrigger key={o.id} value={o.id}>
              {o.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {INSTALL_OPTIONS.map((o) => (
          <TabsContent key={o.id} value={o.id} className="flex w-full flex-col gap-3">
            <p className="text-pretty text-sm text-muted-foreground">{o.summary}</p>
            <CommandBlock commands={o.commands} label={o.label} />
            <p className="font-mono text-xs text-muted-foreground">{o.note}</p>
          </TabsContent>
        ))}
      </Tabs>
      <div className="flex flex-wrap justify-center gap-3">
        <Button render={<a href={LINKS.docs} target="_blank" rel="noreferrer" />} size="lg">
          Docs on GitHub <ExternalLink />
        </Button>
      </div>
    </Section>
  );
}
