/** Centered container for non-instance pages (the instance shell is full-bleed). */
export default function PagesLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-6 py-8">{children}</div>;
}
