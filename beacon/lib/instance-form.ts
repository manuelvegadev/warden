/** Bits the create and import dialogs share so the two forms cannot drift. */

/** Instance id from a display name: the daemon's `^[a-z0-9][a-z0-9-]{1,31}$`. */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

export const ID_PATTERN = "[a-z0-9][a-z0-9-]{1,31}";

export const JVM_PRESETS = { aikar: "Aikar (recommended)", basic: "Basic" } as const;
