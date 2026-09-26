/**
 * Search-as-you-type for the plugin catalog: what counts as a new query, and a small memory of
 * answers so erasing back to an earlier query costs no request.
 */

/** Quiet time after the last keystroke before the catalog is asked. */
export const SEARCH_DELAY_MS = 300;

/** Answers remembered while the dialog is open; the oldest are forgotten first. */
export const SEARCH_MEMORY = 50;

/** The query as the catalog sees it: no outer spaces, inner runs of spaces as one. */
export const normalizeQuery = (q: string) => q.trim().replace(/\s+/g, " ");

/** Empty lists the most downloaded; one character matches too much to be worth a request. */
export const worthSearching = (q: string) => q.length !== 1;

/** The key one answer is remembered under. Queries are normalized, so they hold no newline. */
export const searchKey = (source: string, q: string) => `${source}\n${q}`;

/** Remembers an answer, forgetting the oldest beyond `max`. A key seen again becomes the newest. */
export function remember<T>(memory: Map<string, T>, key: string, value: T, max = SEARCH_MEMORY) {
  memory.delete(key);
  memory.set(key, value);
  for (const oldest of memory.keys()) {
    if (memory.size <= max) break;
    memory.delete(oldest);
  }
}
