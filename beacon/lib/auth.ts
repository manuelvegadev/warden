import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import { jwt } from "better-auth/plugins/jwt";
import { nextCookies } from "better-auth/next-js";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Beacon is the identity authority (ADR-009). wardend verifies the JWTs with /api/auth/jwks.
const DB_PATH = process.env.DATABASE_PATH ?? "./data/beacon.db";
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const discordEnabled = !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);

export const auth = betterAuth({
  appName: "Beacon",
  database: db,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    // No mail server in v1: verification is not required. Enable once `sendVerificationEmail` exists.
    requireEmailVerification: false,
  },
  socialProviders: discordEnabled
    ? { discord: { clientId: process.env.DISCORD_CLIENT_ID!, clientSecret: process.env.DISCORD_CLIENT_SECRET! } }
    : {},
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60, strategy: "jwe" },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 3 },
    },
  },
  trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  advanced: {
    useSecureCookies: baseURL.startsWith("https://"),
    ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] }, // behind Traefik (Dokploy)
  },
  databaseHooks: {
    user: {
      create: {
        // Self-hosted panel: the first user is admin; afterwards only an admin can create users (admin plugin).
        before: async (user) => {
          const { c } = db.prepare("SELECT COUNT(*) AS c FROM user").get() as { c: number };
          if (c === 0) return { data: { ...user, role: "admin" } };
          if (process.env.BEACON_OPEN_SIGNUP === "true") return { data: { ...user, role: "operator" } };
          throw new Error("Registration is closed. Ask an administrator to create your account.");
        },
      },
    },
  },
  plugins: [
    admin({ defaultRole: "operator", adminRoles: ["admin"] }),
    jwt({
      jwks: { keyPairConfig: { alg: "EdDSA", crv: "Ed25519" } },
      jwt: {
        issuer: baseURL,
        audience: "wardend",
        expirationTime: "15m",
        definePayload: ({ user }) => ({ sub: user.id, email: user.email, name: user.name, role: user.role ?? "operator" }),
      },
    }),
    // apiKey: separate package (@better-auth/api-key), pending in roadmap Phase 4
    nextCookies(), // must be last
  ],
});

export type Session = typeof auth.$Infer.Session;
