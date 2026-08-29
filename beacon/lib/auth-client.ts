"use client";

import { adminClient, jwtClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [adminClient(), jwtClient()],
});

export const { useSession, signIn, signOut, signUp } = authClient;
