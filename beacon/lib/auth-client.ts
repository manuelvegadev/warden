"use client";

import { adminClient, jwtClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [adminClient(), jwtClient(), organizationClient()],
});

export const { useSession, signIn, signOut, signUp } = authClient;
