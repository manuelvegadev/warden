import { cn } from "@warden/ui/lib/utils";
import { CONTAINER } from "@/components/section";
import { LINKS } from "@/lib/links";

const FOOTER = [
  { href: LINKS.repo, label: "GitHub" },
  { href: LINKS.docs, label: "Docs" },
  { href: LINKS.adrs, label: "ADRs" },
  { href: LINKS.changelog, label: "Changelog" },
];

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div
        className={cn(
          CONTAINER,
          "flex flex-wrap items-center justify-between gap-4 py-8 text-sm text-muted-foreground",
        )}
      >
        <div>Warden · wardend + Beacon</div>
        <div className="flex gap-5">
          {FOOTER.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
