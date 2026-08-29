import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { UserMenu } from "@/components/user-menu";
import { auth } from "@/lib/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <nav className="flex items-center gap-5 text-sm">
            <Link href="/" className="font-semibold tracking-tight">
              Beacon
            </Link>
            <Link href="/" className="text-muted-foreground hover:text-foreground">
              Instances
            </Link>
            <Link href="/settings/java" className="text-muted-foreground hover:text-foreground">
              Java
            </Link>
          </nav>
          <UserMenu name={session.user.name} email={session.user.email} role={session.user.role ?? "operator"} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
