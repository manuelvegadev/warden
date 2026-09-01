"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_LINES, type Run, scrambleObfuscated, shadowColor } from "@/lib/motd";

/** Inline styles for one run. Bold is the real bold face: it advances a pixel more per glyph. */
export function runStyle(r: Run): React.CSSProperties {
  const decoration = [r.under && "underline", r.strike && "line-through"].filter(Boolean).join(" ");
  return {
    color: r.color,
    ["--mc-shadow" as string]: shadowColor(r.color),
    fontWeight: r.bold ? 700 : 400,
    fontStyle: r.italic ? "italic" : "normal",
    textDecoration: decoration || undefined,
  };
}

/**
 * GUI scale. 1 is what the client draws at its smallest: one Minecraft pixel is one CSS pixel, so
 * the whole entry is 270px of text and a 32px icon. 2 is what most people actually play at.
 */
export type McScale = 1 | 2;

/** The type metrics for a scale — the utility class carries 2x, so 1x overrides it. */
const textStyle = (scale: McScale): React.CSSProperties => (scale === 1 ? { fontSize: 12, lineHeight: "9px" } : {});

/** True while any run is obfuscated, which is the only thing that needs a timer. */
const hasObfuscated = (lines: Run[][]) => lines.some((runs) => runs.some((r) => r.obf));

/**
 * Minecraft text, drawn the way the client draws it. `lines` are already wrapped: anything past
 * the second is greyed out, because that is exactly what the player will not see.
 */
export function MotdText({
  lines,
  scale = 2,
  className = "",
}: {
  lines: Run[][];
  scale?: McScale;
  className?: string;
}) {
  const [, tick] = useState(0);
  const animated = hasObfuscated(lines);

  useEffect(() => {
    if (!animated) return;
    const t = setInterval(() => tick((n) => n + 1), 70);
    return () => clearInterval(t);
  }, [animated]);

  return (
    <div className={`font-minecraft whitespace-pre text-white ${className}`} style={textStyle(scale)}>
      {lines.map((runs, li) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional, there is no id
        <div key={li}>
          {runs.length === 0 && " "}
          {runs.map((r, ri) => {
            const dropped = li >= MAX_LINES;
            return (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional
                key={ri}
                className={dropped ? "text-muted-foreground" : "mc-shadow"}
                style={dropped ? { fontWeight: r.bold ? 700 : 400 } : runStyle(r)}
              >
                {r.obf && !dropped ? scrambleObfuscated(r.text) : r.text}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * The multiplayer list entry: the icon, the name the player gave the server, two lines of MOTD
 * wrapped at 270 game pixels, and the version and player count on the right.
 */
function ServerListEntry({
  name,
  iconSrc,
  lines,
  version,
  players,
  scale = 2,
}: {
  name: string;
  iconSrc: string | null;
  lines: Run[][];
  version?: string;
  players?: string;
  scale?: McScale;
}) {
  const icon = 32 * scale;
  const column = 270 * scale;
  const type = textStyle(scale);

  return (
    <div
      className="flex items-start border-2 border-white/15 bg-white/5"
      style={{ gap: 6 * scale, padding: 4 * scale }}
    >
      {iconSrc ? (
        // biome-ignore lint/performance/noImgElement: a blob or data URL, not a served asset
        <img
          src={iconSrc}
          alt=""
          width={icon}
          height={icon}
          draggable={false}
          className="shrink-0 [image-rendering:pixelated]"
          style={{ width: icon, height: icon }}
        />
      ) : (
        <div
          className="font-minecraft grid shrink-0 place-items-center bg-[#2c2c34] text-[#54545f]"
          style={{ width: icon, height: icon, ...type }}
        >
          ?
        </div>
      )}
      <div className="min-w-0" style={{ width: column }}>
        <div className="font-minecraft mc-shadow text-white [--mc-shadow:#3f3f3f]" style={type}>
          {name}
        </div>
        <MotdText lines={lines} scale={scale} className="min-h-[2lh]" />
      </div>
      {(version || players) && (
        <div
          className="font-minecraft ml-auto grid justify-items-end text-[#a8a8a8]"
          style={{ gap: 2 * scale, ...type }}
        >
          {version && <div className="mc-shadow [--mc-shadow:#2a2a2a]">{version}</div>}
          {players && <div className="mc-shadow [--mc-shadow:#2a2a2a]">{players}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * The entry on the dark ground the multiplayer screen puts behind it.
 *
 * The entry's own width is not negotiable: the MOTD column is 270 game pixels because that is
 * where the client wraps, and stretching it would move the line break somewhere the player will
 * never see it. So when the container is narrower than the entry needs, the whole thing is scaled
 * down uniformly rather than reflowed or scrolled — the layout stays true, it just gets smaller.
 */
export function ServerListPreview(props: React.ComponentProps<typeof ServerListEntry>) {
  const scale = props.scale ?? 2;
  const viewport = useRef<HTMLDivElement>(null);
  const entry = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ factor: 1, height: 0 });

  useEffect(() => {
    const measure = () => {
      const available = viewport.current?.clientWidth ?? 0;
      const natural = entry.current?.scrollWidth ?? 0;
      const height = entry.current?.scrollHeight ?? 0;
      // scrollWidth/Height are layout sizes, so the transform below never feeds back in here.
      const factor = natural > 0 ? Math.min(1, available / natural) : 1;
      setFit((f) => (f.factor === factor && f.height === height * factor ? f : { factor, height: height * factor }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (entry.current) observer.observe(entry.current);
    return () => observer.disconnect();
    // The observer is the subscription: rebuilding it per render would re-measure — a forced
    // reflow — on every keystroke in the editor above.
  }, []);

  return (
    <div className="w-full overflow-hidden rounded-lg border bg-[#0d0d11]" style={{ padding: 4 * scale }}>
      <div ref={viewport} style={{ height: fit.height || undefined }}>
        <div
          ref={entry}
          className="w-fit origin-top-left"
          style={{ transform: fit.factor < 1 ? `scale(${fit.factor})` : undefined }}
        >
          <ServerListEntry {...props} />
        </div>
      </div>
    </div>
  );
}
