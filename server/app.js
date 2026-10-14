import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { digest, token, hashPassword, checkPassword } from "./security.js";
import { awsProvisioner } from "./provisioner.js";

const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(12).max(128),
});
const profileInput = z.object({
  name: z.string().trim().min(1).max(48),
  region: z.string().max(32),
});
const publicUser = (u) => ({ email: u.email, created: u.created });
const publicProfile = (p) => ({
  id: p.id,
  name: p.name,
  region: p.region,
  status: p.status,
  created: p.created,
  downloaded: Boolean(p.downloaded),
  error: p.error,
});
export function createApp(
  config,
  db,
  provisioner = config.provisioner === "aws" ? awsProvisioner(config) : null,
) {
  const app = express();
  if (config.production) app.set("trust proxy", "loopback");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'none'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: "8kb" }), cookieParser());
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use((req, res, next) => {
    const origins = new Set([config.origin]);
    if (config.authMode === "local") {
      const alias = new URL(config.origin);
      if (["localhost", "127.0.0.1"].includes(alias.hostname)) {
        alias.hostname =
          alias.hostname === "localhost" ? "127.0.0.1" : "localhost";
        origins.add(alias.origin);
      }
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !origins.has(req.get("origin"))
    )
      return res.status(403).json({ error: "Request origin is not allowed." });
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many requests. Please wait a minute." },
    }),
  );
  const authLimit = rateLimit({
    windowMs: 900_000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Try again in 15 minutes." },
  });
  app.use("/api/auth", authLimit);
  app.use("/auth", authLimit);
  const cookieOptions = {
    httpOnly: true,
    secure: config.production,
    sameSite: "lax",
    path: "/",
  };
  const cookieName = config.production
    ? "__Host-navalny_session"
    : "navalny_session";
  function session(res, user) {
    const value = token();
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(
      digest(value),
      user.id,
      Date.now() + 3600_000,
    );
    res.cookie(cookieName, value, { ...cookieOptions, maxAge: 3600_000 });
  }
  app.use((req, res, next) => {
    const value = req.cookies[cookieName];
    if (value)
      req.user = db
        .prepare(
          "SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires>?",
        )
        .get(digest(value), Date.now());
    next();
  });
  const requireUser = (req, res, next) =>
    req.user
      ? next()
      : res.status(401).json({ error: "Sign in to manage your VPN profiles." });
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));
  app.get("/api/config", (req, res) =>
    res.json({
      authMode: config.authMode,
      provisioner: config.provisioner,
      domain: "navalnyvpn.net",
      maxProfiles: 5,
    }),
  );
  app.get("/api/me", (req, res) =>
    res.json({ user: req.user ? publicUser(req.user) : null }),
  );
  app.get("/api/regions", (req, res) =>
    res.json({
      regions: config.regions.map(
        ({ id, name, country, code, continent, instanceId }) => ({
          id,
          name,
          country,
          code,
          continent,
          configured: Boolean(instanceId),
        }),
      ),
    }),
  );
  app.post("/api/auth/:action", async (req, res) => {
    if (config.authMode !== "local")
      return res.status(404).json({ error: "Use the secure sign-in page." });
    const { action } = req.params;
    if (!["login", "register"].includes(action)) return res.sendStatus(404);
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({
          error: "Enter a valid email and a password of 12–128 characters.",
        });
    const { email, password } = parsed.data;
    let user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if (action === "register") {
      if (user)
        return res
          .status(409)
          .json({ error: "Unable to create this account. Try signing in." });
      const encoded = await hashPassword(password);
      user = { id: randomUUID(), email, created: new Date().toISOString() };
      try {
        db.prepare("INSERT INTO users VALUES (?, ?, ?, ?)").run(
          user.id,
          email,
          encoded,
          user.created,
        );
      } catch (error) {
        if (error.code?.startsWith("ERR_SQLITE"))
          return res
            .status(409)
            .json({ error: "Unable to create this account. Try signing in." });
        throw error;
      }
    } else if (
      !user?.password ||
      !(await checkPassword(password, user.password))
    ) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    session(res, user);
    res.json({ user: publicUser(user) });
  });
  app.post("/api/logout", (req, res) => {
    if (req.cookies[cookieName])
      db.prepare("DELETE FROM sessions WHERE hash=?").run(
        digest(req.cookies[cookieName]),
      );
    res.clearCookie(cookieName, cookieOptions);
    res.json({
      ok: true,
      redirect:
        config.authMode === "cognito"
          ? `${config.cognito.domain}/logout?client_id=${encodeURIComponent(config.cognito.clientId)}&logout_uri=${encodeURIComponent(config.origin)}`
          : null,
    });
  });
  if (config.authMode === "cognito") {
    const verifier = CognitoJwtVerifier.create({
      userPoolId: config.cognito.userPoolId,
      tokenUse: "id",
      clientId: config.cognito.clientId,
    });
    app.get("/auth/login", (req, res) => {
      const state = token(),
        codeVerifier = token(),
        nonce = token();
      db.prepare("DELETE FROM oauth WHERE expires<?").run(Date.now());
      db.prepare("INSERT INTO oauth VALUES (?, ?, ?, ?)").run(
        digest(state),
        codeVerifier,
        nonce,
        Date.now() + 600_000,
      );
      res.cookie("__Host-navalny_oauth", state, {
        ...cookieOptions,
        maxAge: 600_000,
      });
      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.cognito.clientId,
        redirect_uri: `${config.origin}/auth/callback`,
        scope: "openid email",
        state,
        nonce,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(codeVerifier)
          .digest("base64url"),
      });
      res.redirect(`${config.cognito.domain}/oauth2/authorize?${params}`);
    });
    app.get("/auth/callback", async (req, res) => {
      if (
        typeof req.query.state !== "string" ||
        typeof req.query.code !== "string" ||
        req.cookies["__Host-navalny_oauth"] !== req.query.state
      )
        return res
          .status(400)
          .send("Invalid sign-in state. Please try signing in again.");
      const state = db
        .prepare("DELETE FROM oauth WHERE hash=? AND expires>? RETURNING *")
        .get(digest(req.query.state), Date.now());
      res.clearCookie("__Host-navalny_oauth", cookieOptions);
      if (!state)
        return res.status(400).send("Sign-in expired. Please try again.");
      const response = await fetch(`${config.cognito.domain}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.cognito.clientId,
          code: req.query.code,
          redirect_uri: `${config.origin}/auth/callback`,
          code_verifier: state.verifier,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok)
        return res
          .status(401)
          .send("Sign-in could not be completed. Please try again.");
      const tokens = await response.json();
      const claims = await verifier.verify(tokens.id_token);
      if (claims.nonce !== state.nonce || !claims.email_verified)
        return res.status(401).send("A verified email is required.");
      const user = {
        id: claims.sub,
        email: claims.email.toLowerCase(),
        created: new Date().toISOString(),
      };
      db.prepare(
        "INSERT INTO users VALUES (?, ?, NULL, ?) ON CONFLICT(id) DO UPDATE SET email=excluded.email",
      ).run(user.id, user.email, user.created);
      session(res, user);
      res.redirect("/");
    });
  }
  async function refresh(profile) {
    if (
      !provisioner ||
      !profile.command_id ||
      !["issuing", "revoking"].includes(profile.status)
    )
      return profile;
    const state = await provisioner.status(profile);
    if (state === "pending") return profile;
    const status =
      state === "success"
        ? profile.status === "issuing"
          ? "active"
          : "revoked"
        : profile.status === "revoking"
          ? "revoke_failed"
          : "failed";
    const error =
      state === "failed"
        ? profile.status === "revoking"
          ? "Revocation failed. Retry to invalidate this certificate."
          : "Gateway provisioning failed. Revoke this profile before creating another."
        : null;
    db.prepare(
      "UPDATE profiles SET status=?, error=? WHERE id=? AND command_id=?",
    ).run(status, error, profile.id, profile.command_id);
    return db.prepare("SELECT * FROM profiles WHERE id=?").get(profile.id);
  }
  app.get("/api/profiles", requireUser, async (req, res) => {
    const profiles = db
      .prepare("SELECT * FROM profiles WHERE user_id=? ORDER BY created DESC")
      .all(req.user.id);
    res.json({
      profiles: (await Promise.all(profiles.map(refresh))).map(publicProfile),
    });
  });
  app.post("/api/profiles", requireUser, async (req, res) => {
    const parsed = profileInput.safeParse(req.body);
    if (
      !parsed.success ||
      !config.regions.some((r) => r.id === parsed.data.region)
    )
      return res
        .status(400)
        .json({ error: "Choose a valid device name and region." });
    const count = db
      .prepare(
        "SELECT COUNT(*) AS n FROM profiles WHERE user_id=? AND status NOT IN ('revoked')",
      )
      .get(req.user.id).n;
    if (count >= 5)
      return res
        .status(409)
        .json({
          error:
            "You can have 5 profiles. Revoke a profile before adding another.",
        });
    const p = {
      id: `nv-${randomUUID()}`,
      user_id: req.user.id,
      ...parsed.data,
      status: provisioner ? "issuing" : "draft",
      created: new Date().toISOString(),
    };
    db.prepare(
      "INSERT INTO profiles (id,user_id,name,region,status,created) VALUES (?,?,?,?,?,?)",
    ).run(p.id, p.user_id, p.name, p.region, p.status, p.created);
    try {
      if (provisioner)
        db.prepare("UPDATE profiles SET command_id=? WHERE id=?").run(
          await provisioner.start("issue", p),
          p.id,
        );
    } catch (error) {
      db.prepare("UPDATE profiles SET status='failed', error=? WHERE id=?").run(
        "Could not reach the gateway. Revoke this profile and try again.",
        p.id,
      );
      throw error;
    }
    res
      .status(201)
      .json({
        profile: publicProfile(
          db.prepare("SELECT * FROM profiles WHERE id=?").get(p.id),
        ),
      });
  });
  const owned = (req, res, next) => {
    req.profile = db
      .prepare("SELECT * FROM profiles WHERE id=? AND user_id=?")
      .get(req.params.id, req.user.id);
    return req.profile
      ? next()
      : res.status(404).json({ error: "Profile not found." });
  };
  // A per-profile lock prevents concurrent requests downloading the same private key.
  const downloading = new Set();
  app.post(
    "/api/profiles/:id/download",
    requireUser,
    owned,
    async (req, res) => {
      const p = await refresh(req.profile);
      if (!provisioner || p.status !== "active" || p.downloaded)
        return res
          .status(409)
          .json({
            error: p.downloaded
              ? "This profile has already been downloaded. Create a new profile if you need another copy."
              : "A deployed, ready gateway is required before downloading a profile.",
          });
      if (downloading.has(p.id))
        return res
          .status(409)
          .json({ error: "A download is already in progress." });
      downloading.add(p.id);
      try {
        const bytes = await provisioner.download(p);
        await provisioner.removeArtifact(p);
        db.prepare("UPDATE profiles SET downloaded=1 WHERE id=?").run(p.id);
        res.set({
          "Content-Type": "application/x-openvpn-profile",
          "Content-Disposition": `attachment; filename="navalnyvpn-${p.region}-${p.id.slice(-8)}.ovpn"`,
          "Cache-Control": "no-store, private",
          Pragma: "no-cache",
        });
        res.send(Buffer.from(bytes));
      } catch (error) {
        if (["NoSuchKey", "NotFound"].includes(error.name))
          return res
            .status(410)
            .json({
              error:
                "Download expired. Revoke this profile and create a new one.",
            });
        throw error;
      } finally {
        downloading.delete(p.id);
      }
    },
  );
  app.delete("/api/profiles/:id", requireUser, owned, async (req, res) => {
    const p = await refresh(req.profile);
    if (["issuing", "revoking"].includes(p.status))
      return res
        .status(409)
        .json({
          error: "This profile is still being processed. Try again shortly.",
        });
    if (p.status === "revoked") return res.json({ ok: true });
    if (!provisioner || p.status === "draft")
      db.prepare(
        "UPDATE profiles SET status='revoked',error=NULL WHERE id=?",
      ).run(p.id);
    else {
      const command = await provisioner.start("revoke", p);
      db.prepare(
        "UPDATE profiles SET status='revoking',command_id=?,error=NULL WHERE id=?",
      ).run(command, p.id);
      await provisioner.removeArtifact(p);
    }
    res.json({ ok: true });
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  const dist = resolve("dist");
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get("/{*path}", (req, res) =>
      res.sendFile(resolve(dist, "index.html")),
    );
  }
  app.use((error, req, res, next) => {
    // Never log request bodies, tokens, email addresses, or command output.
    console.error("Request failed:", error.name || "Error");
    if (error.type === "entity.parse.failed")
      return res.status(400).json({ error: "Invalid JSON body." });
    res
      .status(503)
      .json({
        error: "The service could not complete this request. Please try again.",
      });
  });
  return app;
}
