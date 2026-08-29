export default async function InstancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">{id}</h1>
      <p className="mt-2 text-zinc-400">Console, configuration, plugins, players and backups (coming soon).</p>
    </main>
  );
}
