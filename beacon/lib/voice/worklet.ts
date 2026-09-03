const registered = new WeakMap<AudioContext, Set<string>>();

/**
 * Registers an AudioWorklet processor whose source is a string, from a Blob URL (no bundler
 * configuration for worklet files), once per context and name.
 */
export async function registerWorklet(ctx: AudioContext, name: string, source: string): Promise<void> {
  let names = registered.get(ctx);
  if (names?.has(name)) return;
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  if (!names) {
    names = new Set();
    registered.set(ctx, names);
  }
  names.add(name);
}
