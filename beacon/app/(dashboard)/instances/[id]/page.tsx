import { redirect } from "next/navigation";
import { instanceHref } from "@/lib/instance-routes";

export default async function InstanceIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(instanceHref(id));
}
