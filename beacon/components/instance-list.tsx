"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { instances, type InstanceSummary } from "@/lib/api";

export function InstanceList() {
  const [items, setItems] = useState<InstanceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    instances.list().then(setItems).catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (error) return <p className="mt-6 text-red-400">No se pudo conectar con el daemon: {error}</p>;
  if (!items) return <p className="mt-6 text-zinc-400">Cargando…</p>;
  if (items.length === 0) return <p className="mt-6 text-zinc-400">No hay instancias todavía.</p>;

  return (
    <ul className="mt-6 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
      {items.map((i) => (
        <li key={i.id} className="flex items-center justify-between p-4">
          <div>
            <Link href={`/instances/${i.id}`} className="font-medium hover:underline">
              {i.name}
            </Link>
            <div className="text-xs text-zinc-400">
              {i.software} {i.mcVersion} #{i.build} · :{i.port}
            </div>
          </div>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs">{i.state}</span>
        </li>
      ))}
    </ul>
  );
}
