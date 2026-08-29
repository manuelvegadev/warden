import { notFound } from "next/navigation";
import { InstanceProvider } from "@/components/instance/instance-context";
import { InstanceShell } from "@/components/instance/instance-shell";
import type { InstanceDetail } from "@/lib/api";
import { getSession } from "@/lib/session";
import { wardendFetch } from "@/lib/wardend";

export default async function InstanceLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const [res, session] = await Promise.all([wardendFetch(`/instances/${id}`), getSession()]);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`wardend returned ${res.status}`);
  const detail = (await res.json()) as InstanceDetail;
  return (
    <InstanceProvider initial={detail} isAdmin={session?.user.role === "admin"}>
      <InstanceShell>{children}</InstanceShell>
    </InstanceProvider>
  );
}
