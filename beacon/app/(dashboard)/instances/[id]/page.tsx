import { notFound } from "next/navigation";
import { wardendFetch } from "@/lib/wardend";
import type { InstanceDetail } from "@/lib/api";
import { InstanceView } from "@/components/instance/instance-view";

export default async function InstancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await wardendFetch(`/instances/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`wardend returned ${res.status}`);
  const detail = (await res.json()) as InstanceDetail;
  return <InstanceView initial={detail} />;
}
