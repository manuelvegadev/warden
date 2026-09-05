import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { safeNext } from "@/lib/http";
import { getSession } from "@/lib/session";

// The proxy appends ?next=<path>; read it on the server so the page needs no client-side
// search-params hook (which would bail out of prerendering).
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getSession()) redirect(safeNext(next)); // already signed in (validated, not just a cookie)
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <LoginForm next={safeNext(next)} />
    </main>
  );
}
