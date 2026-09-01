import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { jwt } from "better-auth/plugins/jwt";
import { organization } from "better-auth/plugins/organization";
import { getDb } from "./db";
import {
  claimsFor,
  defaultOrganizationId,
  grantFromInvitation,
  hasPendingInvitation,
  joinDefaultOrganization,
  NODE_ID,
} from "./org";

// Beacon is the identity authority (ADR-009). wardend verifies the JWTs with /api/auth/jwks and
// reads the access claims out of them (ADR-017).
//
// Everything is created on first use, not at import: `next build` evaluates this module while
// prerendering, and the build must not need the database or the runtime secrets.
function createAuth() {
  const db = getDb();
  const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const discordClientId = process.env.DISCORD_CLIENT_ID;
  const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
  const openSignup = process.env.BEACON_OPEN_SIGNUP === "true";

  return betterAuth({
    appName: "Beacon",
    database: db,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      // No mail server in v1: verification is not required. Enable once `sendVerificationEmail` exists.
      requireEmailVerification: false,
    },
    socialProviders:
      discordClientId && discordClientSecret
        ? { discord: { clientId: discordClientId, clientSecret: discordClientSecret } }
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
    trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    advanced: {
      useSecureCookies: baseURL.startsWith("https://"),
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] }, // behind Traefik (Dokploy)
    },
    databaseHooks: {
      session: {
        create: {
          // One organization per deployment, so every session is active in it. The very first
          // sign-up is the exception — its session is created before the organization exists — so
          // server-side calls still pass organizationId explicitly rather than trust this.
          before: async (session) => {
            const organizationId = defaultOrganizationId(db);
            return organizationId ? { data: { ...session, activeOrganizationId: organizationId } } : undefined;
          },
        },
      },
      user: {
        create: {
          // Self-hosted panel: the first user is admin. Afterwards an account can only be created by
          // following an invitation — or by anyone, if the operator opened signup on purpose.
          before: async (user) => {
            const { c } = db.prepare("SELECT COUNT(*) AS c FROM user").get() as { c: number };
            if (c === 0) return { data: { ...user, role: "admin" } };
            if (hasPendingInvitation(db, user.email)) return { data: { ...user, role: "operator" } };
            if (openSignup) return { data: { ...user, role: "operator" } };
            // A plain Error is swallowed into a generic "Failed to create user"; an APIError keeps
            // the reason, which is the whole point of the message.
            throw new APIError("FORBIDDEN", {
              code: "REGISTRATION_CLOSED",
              message: "Registration is closed. Ask an administrator for an invitation.",
            });
          },
          // The first user owns the default organization. An invited user gets their membership from
          // accepting the invitation, so only open-signup arrivals are added here.
          after: async (user) => {
            joinDefaultOrganization(db, user.id, user.email, { openSignup });
          },
        },
      },
    },
    plugins: [
      admin({ defaultRole: "operator", adminRoles: ["admin"] }),
      organization({
        // One organization per deployment for now; it stays hidden in the UI while that holds (ADR-017 §1).
        allowUserToCreateOrganization: false,
        creatorRole: "owner",
        invitationExpiresIn: 60 * 60 * 24 * 7,
        cancelPendingInvitationsOnReInvite: true,
        // No mail server (ADR-017 §6): the inviter copies the link from Settings → Members. The
        // invitation id is a bearer token, so it is deliberately never written to the log.
        sendInvitationEmail: async () => {},
        schema: {
          invitation: {
            additionalFields: {
              nodeId: { type: "string", required: false, input: true, defaultValue: NODE_ID },
              instanceId: { type: "string", required: false, input: true },
              instanceRole: { type: "string", required: false, input: true },
            },
          },
        },
        organizationHooks: {
          // Turn the instance carried by the invitation into a real grant.
          afterAcceptInvitation: async ({ invitation, member }) => {
            grantFromInvitation(db, invitation, member.userId);
          },
        },
      }),
      jwt({
        jwks: { keyPairConfig: { alg: "EdDSA", crv: "Ed25519" } },
        jwt: {
          issuer: baseURL,
          audience: "wardend",
          expirationTime: "15m",
          // Beacon resolves the permissions, wardend enforces them (ADR-017 §4). Runs per signed
          // token, i.e. per proxied REST request, so a revoked grant stops working immediately.
          definePayload: async ({ user }) => {
            const { caps, aclAll, acl } = claimsFor(db, user.id, user.role);
            return {
              sub: user.id,
              email: user.email,
              name: user.name,
              role: user.role ?? "operator",
              node: NODE_ID,
              caps,
              ...(aclAll ? { aclAll } : {}),
              ...(Object.keys(acl).length > 0 ? { acl } : {}),
            };
          },
        },
      }),
      // apiKey: separate package (@better-auth/api-key), pending in roadmap Phase 4
      nextCookies(), // must be last
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

/** The Better Auth instance, instantiated lazily on first property access. */
export const auth: Auth = new Proxy({} as Auth, {
  get(_, prop) {
    instance ??= createAuth();
    return Reflect.get(instance, prop);
  },
  // toNextJsHandler does `"handler" in auth`; without this trap the empty target answers "no".
  has(_, prop) {
    instance ??= createAuth();
    return prop in instance;
  },
  // The `auth` CLI loads this module through c12, which merges the export with defu — that walks the
  // own keys, and an empty target has none, so `auth generate|migrate` saw an empty config.
  ownKeys() {
    instance ??= createAuth();
    return Reflect.ownKeys(instance);
  },
  getOwnPropertyDescriptor(_, prop) {
    instance ??= createAuth();
    const d = Reflect.getOwnPropertyDescriptor(instance, prop);
    // The target is empty and extensible, so every reported property must be configurable.
    return d && { ...d, configurable: true };
  },
});

export type Session = Auth["$Infer"]["Session"];
