import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createApp } from "../server/app.js";
import { openStore } from "../server/store.js";
import { loadConfig } from "../server/config.js";

async function fixture(t, provisioner = null) {
  const dir = await mkdtemp(join(tmpdir(), "navalny-test-"));
  const db = openStore(dir);
  const config = loadConfig({});
  const server = createApp(config, db, provisioner).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  async function request(
    path,
    { cookie, body, method = "GET", origin = config.origin } = {},
  ) {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      {
        method,
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    const result = {
      status: res.status,
      headers: res.headers,
      cookie: res.headers.get("set-cookie")?.split(";")[0],
    };
    if (res.headers.get("content-type")?.includes("json"))
      result.body = await res.json();
    else result.text = await res.text();
    return result;
  }
  const register = (email) =>
    request("/auth/register", {
      method: "POST",
      body: { email, password: "test-only-password-123" },
    });
  return { request, register, db };
}
test("accounts hash passwords, persist sessions, reject invalid input and sign out", async (t) => {
  const { request, register, db } = await fixture(t);
  assert.equal(
    (
      await request("/auth/register", {
        method: "POST",
        body: { email: "bad", password: "short" },
      })
    ).status,
    400,
  );
  const account = await register("alice@example.com");
  assert.equal(account.status, 200);
  assert.match(account.headers.get("set-cookie"), /HttpOnly/);
  assert.match(account.headers.get("set-cookie"), /SameSite=Lax/);
  const stored = await db.getUserByEmail("alice@example.com");
  assert.notEqual(stored.password, "test-only-password-123");
  assert.ok(!JSON.stringify(account.body).includes(stored.password));
  assert.equal(
    (await request("/me", { cookie: account.cookie })).body.user.email,
    "alice@example.com",
  );
  assert.equal(
    (
      await request("/auth/login", {
        method: "POST",
        body: { email: stored.email, password: "wrong password 1234" },
      })
    ).status,
    401,
  );
  assert.equal((await register("alice@example.com")).status, 409);
  assert.equal(
    (
      await request("/auth/login", {
        method: "POST",
        body: { email: stored.email, password: "test-only-password-123" },
      })
    ).status,
    200,
  );
  await request("/logout", { method: "POST", cookie: account.cookie });
  assert.equal(
    (await request("/me", { cookie: account.cookie })).body.user,
    null,
  );
});
test("CSRF guard rejects cross-origin writes and anonymous profile access", async (t) => {
  const { request } = await fixture(t);
  assert.equal((await request("/profiles")).status, 401);
  assert.equal(
    (
      await request("/auth/register", {
        method: "POST",
        origin: "https://evil.example",
        body: {
          email: "x@example.com",
          password: "test-only-password-123",
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/config")).headers.get("cache-control"),
    "no-store",
  );
});
test("shared rate-limit storage counts requests in fixed windows", async (t) => {
  const { db } = await fixture(t);
  const start = 1_800_000_000_000;
  const first = await db.incrementRateLimit("api:client-a", 60_000, start);
  const second = await db.incrementRateLimit("api:client-a", 60_000, start + 1);
  const nextWindow = await db.incrementRateLimit("api:client-a", 60_000, start + 60_000);
  const otherClient = await db.incrementRateLimit("api:client-b", 60_000, start);
  assert.deepEqual([first.totalHits, second.totalHits, nextWindow.totalHits, otherClient.totalHits], [1, 2, 1, 1]);
});
test("profile ownership, region validation, limits, disabled downloads and draft revocation", async (t) => {
  const { request, register } = await fixture(t);
  const alice = await register("alice@example.com"),
    bob = await register("bob@example.com");
  const make = (region = "eu-central-1") =>
    request("/profiles", {
      method: "POST",
      cookie: alice.cookie,
      body: { name: "My laptop", region },
    });
  assert.equal((await make("unknown")).status, 400);
  const created = await make();
  assert.equal(created.status, 201);
  const p = created.body.profile;
  assert.equal(p.status, "draft");
  assert.equal(
    (await request("/profiles", { cookie: alice.cookie })).body.profiles.length,
    1,
  );
  assert.equal(
    (await request("/profiles", { cookie: bob.cookie })).body.profiles.length,
    0,
  );
  assert.equal(
    (
      await request(`/profiles/${p.id}`, {
        cookie: bob.cookie,
        method: "DELETE",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/profiles/${p.id}/download`, {
        method: "POST",
        cookie: bob.cookie,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/profiles/${p.id}/download`, {
        method: "POST",
        cookie: alice.cookie,
      })
    ).status,
    409,
  );
  for (let i = 0; i < 4; i++) assert.equal((await make()).status, 201);
  assert.equal((await make()).status, 409);
  assert.equal(
    (
      await request(`/profiles/${p.id}`, {
        method: "DELETE",
        cookie: alice.cookie,
      })
    ).status,
    200,
  );
  assert.equal((await make()).status, 201);
});
test("AWS profile state transitions, single download, failed revocation and safe retry", async (t) => {
  let commandState = "pending",
    removeCount = 0;
  const provisioner = {
    start: async (action) => action + "-command",
    status: async () => commandState,
    download: async () => Buffer.from("client\n<key>test fixture only</key>"),
    removeArtifact: async () => {
      removeCount++;
    },
  };
  const { request, register } = await fixture(t, provisioner);
  const { cookie } = await register("test@example.com");
  const {
    body: { profile: p },
  } = await request("/profiles", {
    method: "POST",
    cookie,
    body: { name: "Laptop", region: "eu-central-1" },
  });
  assert.equal(p.status, "issuing");
  assert.equal(
    (await request(`/profiles/${p.id}`, { method: "DELETE", cookie })).status,
    409,
  );
  commandState = "success";
  assert.equal(
    (await request("/profiles", { cookie })).body.profiles[0].status,
    "active",
  );
  const downloaded = await request(`/profiles/${p.id}/download`, {
    method: "POST",
    cookie,
  });
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.headers.get("content-disposition"), /attachment/);
  assert.equal(removeCount, 1);
  assert.equal(
    (await request(`/profiles/${p.id}/download`, { method: "POST", cookie }))
      .status,
    409,
  );
  await request(`/profiles/${p.id}`, { method: "DELETE", cookie });
  commandState = "failed";
  assert.equal(
    (await request("/profiles", { cookie })).body.profiles[0].status,
    "revoke_failed",
  );
  assert.equal(
    (await request(`/profiles/${p.id}/download`, { method: "POST", cookie }))
      .status,
    409,
  );
  await request(`/profiles/${p.id}`, { method: "DELETE", cookie });
  commandState = "success";
  assert.equal(
    (await request("/profiles", { cookie })).body.profiles[0].status,
    "revoked",
  );
});
test("concurrent profile downloads are serialized across API requests", async (t) => {
  let beginDownload;
  let finishDownload;
  const started = new Promise((resolve) => { beginDownload = resolve; });
  const blocked = new Promise((resolve) => { finishDownload = resolve; });
  let downloadCount = 0;
  const provisioner = {
    start: async () => "issue-command",
    status: async () => "success",
    download: async () => {
      downloadCount++;
      beginDownload();
      await blocked;
      return Buffer.from("profile fixture");
    },
    removeArtifact: async () => {},
  };
  const { request, register } = await fixture(t, provisioner);
  const cookie = (await register("single-use@example.com")).cookie;
  const created = await request("/profiles", {
    method: "POST", cookie, body: { name: "Laptop", region: "eu-central-1" },
  });
  const id = created.body.profile.id;
  const first = request(`/profiles/${id}/download`, { method: "POST", cookie });
  await started;
  const second = await request(`/profiles/${id}/download`, { method: "POST", cookie });
  assert.equal(second.status, 409);
  finishDownload();
  assert.equal((await first).status, 200);
  assert.equal(downloadCount, 1);
});
test("download expiration does not return fake profile data", async (t) => {
  const provisioner = {
    start: async () => "command",
    status: async () => "success",
    download: async () => {
      throw Object.assign(new Error(), { name: "NoSuchKey" });
    },
    removeArtifact: async () => {},
  };
  const { request, register } = await fixture(t, provisioner);
  const { cookie } = await register("test@example.com");
  const {
    body: { profile: p },
  } = await request("/profiles", {
    method: "POST",
    cookie,
    body: { name: "Laptop", region: "eu-central-1" },
  });
  assert.equal(
    (await request(`/profiles/${p.id}/download`, { method: "POST", cookie }))
      .status,
    410,
  );
});
test("production cannot silently use local authentication or plain HTTP", () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: "production" }),
    /Production requires/,
  );
  assert.throws(() => loadConfig({ AUTH_MODE: "cognito" }), /Missing Cognito/);
  assert.throws(() => loadConfig({ PROVISIONER: "aws" }), /Incomplete AWS/);
});
