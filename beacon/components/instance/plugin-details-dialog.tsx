"use client";

import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@warden/ui/components/dialog";
import { Code2, Download, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { PluginIcon } from "@/components/instance/plugin-icon";
import { PluginSourceBadge, sourceLabel } from "@/components/instance/plugin-source-badge";
import { compactNum, type PluginHit, plugins } from "@/lib/api";

/** Identifies a catalog project; `null` closes the details dialog. */
export interface PluginRef {
  source: string;
  id: string;
}

/**
 * Project page (summary + README from the catalog). Mount one per list and drive it with a
 * `selected` ref, so rows only need a button, not their own dialog instance.
 */
export function PluginDetailsDialog({ selected, onClose }: { selected: PluginRef | null; onClose: () => void }) {
  const [hit, setHit] = useState<PluginHit | null>(null);

  useEffect(() => {
    if (!selected) return;
    let stale = false;
    setHit(null);
    plugins
      .get(selected.source, selected.id)
      .then((h) => {
        if (!stale) setHit(h);
      })
      .catch((e) => {
        toast.error(e.message);
        onClose();
      });
    return () => {
      stale = true;
    };
  }, [selected, onClose]);

  return (
    <Dialog open={selected !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader className="flex-row items-start gap-4">
          {/* 72px = title + subtitle + tag row, so the icon spans exactly the text block. */}
          <PluginIcon src={hit?.iconUrl} className="size-18" />
          <div className="min-w-0 flex-1 pr-8">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {hit?.name ?? selected?.id}
              {selected && <PluginSourceBadge source={selected.source} />}
            </DialogTitle>
            <DialogDescription className="mt-1">
              {hit ? (
                <>
                  by {hit.author || "—"} · <Download className="inline size-3.5 align-[-2px]" aria-hidden />{" "}
                  {compactNum(hit.downloads)} downloads
                </>
              ) : (
                "Loading…"
              )}
            </DialogDescription>
            {hit && hit.categories.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {hit.categories.map((c) => (
                  <Badge key={c} variant="secondary" className="capitalize">
                    {c.replaceAll("_", " ")}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          {hit && (
            <div className="flex gap-1 self-end">
              <IconLink href={hit.url} label={`Open on ${sourceLabel(hit.source)}`} icon={ExternalLink} />
              {hit.sourceUrl && <IconLink href={hit.sourceUrl} label="Open source code" icon={Code2} />}
            </div>
          )}
        </DialogHeader>
        {hit && (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border px-5 py-4">
            {hit.description && <p className="mb-4 text-sm text-muted-foreground">{hit.description}</p>}
            {hit.body ? (
              <div className="markdown text-sm">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  // READMEs mix Markdown with HTML (<center>, <img>, <details>); parse it, then strip anything unsafe.
                  rehypePlugins={[rehypeRaw, rehypeSanitize]}
                  components={{
                    a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
                  }}
                >
                  {hit.body}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">This project has no README.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Icon-only external link (opens in a new tab). */
export function IconLink({
  href,
  label,
  icon: Icon,
  variant = "outline",
}: {
  href: string;
  label: string;
  icon: typeof ExternalLink;
  variant?: "outline" | "ghost";
}) {
  return (
    <Button
      variant={variant}
      size="icon-sm"
      aria-label={label}
      title={label}
      render={<a href={href} target="_blank" rel="noreferrer" />}
      nativeButton={false}
    >
      <Icon className="size-4" />
    </Button>
  );
}

/** Plugin name rendered as a button that opens the details dialog. Safe inside a <label>. */
export function PluginNameButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="text-left font-medium hover:underline"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
