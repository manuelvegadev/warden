import { cn } from "@warden/ui/lib/utils";
import { fileIconSrc, folderIconSrc } from "@/lib/file-icons";

/** The Atom Material icon for an entry: folders by name (open when their contents show), files by name and path. */
export function FileIcon({
  name,
  dir,
  path,
  open,
  className,
}: {
  name: string;
  dir: boolean;
  /** Path relative to the server root, for the rules that look at directories. */
  path?: string;
  open?: boolean;
  className?: string;
}) {
  const src = dir ? folderIconSrc(name, open) : fileIconSrc(name, path ?? name);
  // biome-ignore lint/performance/noImgElement: inline SVG data URIs, not assets for next/image
  return <img src={src} alt="" aria-hidden draggable={false} className={cn("size-4 shrink-0", className)} />;
}
