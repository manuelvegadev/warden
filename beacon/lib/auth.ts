import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import { jwt } from "better-auth/plugins/jwt";
import { nextCookies } from "better-auth/next-js";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Beacon es la autoridad de identidad (ADR-009). wardend verifica los JWT con /api/auth/jwks.
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
    // Sin servidor de correo en v1: no exigimos verificación. Activar cuando exista `sendVerificationEmail`.
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
    ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] }, // detrás de Traefik (Dokploy)
  },
  databaseHooks: {
    user: {
      create: {
        // Panel self-hosted: el primer usuario es admin; después solo un admin puede crear usuarios (plugin admin).
        before: async (user) => {
          const { c } = db.prepare("SELECT COUNT(*) AS c FROM user").get() as { c: number };
          if (c === 0) return { data: { ...user, role: "admin" } };
          if (process.env.BEACON_OPEN_SIGNUP === "true") return { data: { ...user, role: "operator" } };
          throw new Error("El registro está cerrado. Pide a un administrador que cree tu cuenta.");
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
    // apiKey: paquete aparte (@better-auth/api-key), pendiente en roadmap Fase 4
    nextCookies(), // debe ir el último
  ],
});

export type Session = typeof auth.$Infer.Session;
