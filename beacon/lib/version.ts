/** Beacon's own version: the release tag or commit sha baked in at build time (Dockerfile ARG VERSION). */
const raw = process.env.NEXT_PUBLIC_BEACON_VERSION ?? "dev";
export const BEACON_VERSION = /^[0-9a-f]{40}$/.test(raw) ? raw.slice(0, 7) : raw;
