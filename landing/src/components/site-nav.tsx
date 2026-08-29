import { Button } from "@warden/ui/components/button";
import { cn } from "@warden/ui/lib/utils";
import { BookOpen, Download, Sparkles } from "lucide-react";
import { Logo } from "@/components/logo";
import { CONTAINER } from "@/components/section";
import { LINKS } from "@/lib/links";

/** GitHub mark (lucide dropped brand icons); same 16px grid as the lucide icons beside it. */
function GitHubMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const NAV = [
  { href: "#features", label: "Features", icon: Sparkles },
  { href: "#install", label: "Install", icon: Download },
  { href: LINKS.docs, label: "Docs", icon: BookOpen, external: true },
  { href: LINKS.repo, label: "GitHub", icon: GitHubMark, external: true },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className={cn(CONTAINER, "flex h-14 items-center justify-between")}>
        <a href="#top" className="flex items-center gap-2 text-base font-semibold">
          <Logo />
          Warden
        </a>
        <nav className="flex items-center gap-1">
          {NAV.map(({ href, label, icon: Icon, external }) => (
            <Button
              key={label}
              variant="ghost"
              className="hidden text-muted-foreground hover:text-foreground sm:inline-flex"
              render={<a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})} />}
            >
              <Icon data-icon="inline-start" aria-hidden />
              {label}
            </Button>
          ))}
          <Button className="ml-2" render={<a href="#install" />}>
            Get started
          </Button>
        </nav>
      </div>
    </header>
  );
}
