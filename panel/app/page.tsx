import { InstanceList } from "@/components/instance-list";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Instancias</h1>
      <p className="mt-1 text-sm text-zinc-400">Daemon: {process.env.NEXT_PUBLIC_MCD_URL ?? "http://localhost:8080"}</p>
      <InstanceList />
    </main>
  );
}
