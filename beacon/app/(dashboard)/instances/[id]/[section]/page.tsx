"use client";

import { notFound, useParams } from "next/navigation";
import { useInstance } from "@/components/instance/instance-context";
import { sectionBySlug } from "@/components/instance/sections";

export default function SectionPage() {
  const { section } = useParams<{ section: string }>();
  const state = useInstance();
  const def = sectionBySlug(section);
  if (!def || def.hidden?.(state.manifest.software)) notFound();
  return <>{def.render(state)}</>;
}
