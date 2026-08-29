import { notFound } from "next/navigation";
import { InstanceView } from "@/components/instance/instance-view";
import type { InstanceDetail } from "@/lib/api";
import { getSession } from "@/lib/session";
import { wardendFetch } from "@/lib/wardend";

export default async function InstancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [res, session] = await Promise.all([wardendFetch(`/instances/${id}`), getSession()]);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`wardend returned ${res.status}`);
  const detail = (await res.json()) as InstanceDetail;
  return <InstanceView initial={detail} isAdmin={session?.user.role === "admin"} />;
}
