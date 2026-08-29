import { LoginForm } from "@/components/login-form";

/** Only same-origin relative paths are valid post-login targets (no open redirect). */
const safeNext = (v: string | undefined) => (v?.startsWith("/") && !v.startsWith("//") ? v : "/");

// The proxy appends ?next=<path>; read it on the server so the page needs no client-side
// search-params hook (which would bail out of prerendering).
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <LoginForm next={safeNext(next)} />
    </main>
  );
}
