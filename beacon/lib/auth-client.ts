"use client";

import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";
import { jwtClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [adminClient(), jwtClient()],
});

export const { useSession, signIn, signOut, signUp } = authClient;
