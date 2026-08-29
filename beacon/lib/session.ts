import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "@/lib/auth";

/** Per-request memoized session so the layout and pages share one lookup. */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));
