/** SVG `M/L` path for a 0..1 series stretched over w×h with a 2px inset. */
export const linePath = (data: number[], w: number, h: number) =>
  data
    .map((v, i) => `${i ? "L" : "M"}${((i / (data.length - 1)) * w).toFixed(1)} ${(h - 2 - v * (h - 6)).toFixed(1)}`)
    .join(" ");

/** Area + line path for a 0..1 series, drawn behind a stat tile (as Beacon's resource cards do). */
export function Sparkline({ data, className }: { data: number[]; className?: string }) {
  const w = 200;
  const h = 60;
  const line = linePath(data, w, h);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="currentColor" fillOpacity="0.06" />
      <path d={line} fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" />
    </svg>
  );
}
