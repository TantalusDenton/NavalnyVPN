import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";

function openSqlite(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dir, "navalnyvpn.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth (hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
      region TEXT NOT NULL, status TEXT NOT NULL, command_id TEXT, created TEXT NOT NULL, downloaded INTEGER NOT NULL DEFAULT 0, error TEXT);
    CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
  `);
  for (const column of ["download_lock_until INTEGER", "download_lock_token TEXT"]) {
    try { db.exec(`ALTER TABLE profiles ADD COLUMN ${column}`); }
    catch (error) { if (!String(error.message).includes("duplicate column name")) throw error; }
  }
  return {
    close: () => db.close(),
    async getUserByEmail(email) {
      return db.prepare("SELECT * FROM users WHERE email=?").get(email);
    },
    async getUserBySessionHash(hash, now) {
      return db.prepare("SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires>?").get(hash, now);
    },
    async createLocalUser(user, password) {
      try {
        db.prepare("INSERT INTO users VALUES (?, ?, ?, ?)").run(user.id, user.email, password, user.created);
        return true;
      } catch (error) {
        if (error.code?.startsWith("ERR_SQLITE_CONSTRAINT")) return false;
        throw error;
      }
    },
    async upsertCognitoUser(user) {
      db.prepare("INSERT INTO users VALUES (?, ?, NULL, ?) ON CONFLICT(id) DO UPDATE SET email=excluded.email").run(user.id, user.email, user.created);
    },
    async createSession(hash, userId, expires) {
      db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(hash, userId, expires);
    },
    async deleteSession(hash) {
      db.prepare("DELETE FROM sessions WHERE hash=?").run(hash);
    },
    async deleteExpiredSessions(now) {
      db.prepare("DELETE FROM sessions WHERE expires<?").run(now);
      db.prepare("DELETE FROM rate_limits WHERE expires<?").run(now);
    },
    async incrementRateLimit(requestKey, windowMs, now) {
      const bucketStart = Math.floor(now / windowMs) * windowMs;
      const bucket = createHash("sha256").update(`${requestKey}:${bucketStart}`).digest("hex");
      const row = db.prepare("INSERT INTO rate_limits (bucket,count,expires) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count")
        .get(bucket, bucketStart + windowMs);
      return { totalHits: row.count, resetTime: new Date(bucketStart + windowMs) };
    },
    async putOAuth(item) {
      db.prepare("DELETE FROM oauth WHERE expires<?").run(Date.now());
      db.prepare("INSERT INTO oauth VALUES (?, ?, ?, ?)").run(item.hash, item.verifier, item.nonce, item.expires);
    },
    async consumeOAuth(hash, now) {
      return db.prepare("DELETE FROM oauth WHERE hash=? AND expires>? RETURNING *").get(hash, now);
    },
    async createProfile(profile) {
      db.prepare("INSERT INTO profiles (id,user_id,name,region,status,created) VALUES (?,?,?,?,?,?)").run(
        profile.id, profile.user_id, profile.name, profile.region, profile.status, profile.created,
      );
    },
    async getProfile(id) {
      return db.prepare("SELECT * FROM profiles WHERE id=?").get(id);
    },
    async getOwnedProfile(id, userId) {
      return db.prepare("SELECT * FROM profiles WHERE id=? AND user_id=?").get(id, userId);
    },
    async listProfiles(userId) {
      return db.prepare("SELECT * FROM profiles WHERE user_id=? ORDER BY created DESC").all(userId);
    },
    async countActiveProfiles(userId) {
      return db.prepare("SELECT COUNT(*) AS n FROM profiles WHERE user_id=? AND status NOT IN ('revoked')").get(userId).n;
    },
    async updateProfile(id, fields) {
      const keys = Object.keys(fields);
      if (!keys.length) return this.getProfile(id);
      db.prepare(`UPDATE profiles SET ${keys.map((key) => `${key}=?`).join(",")} WHERE id=?`)
        .run(...keys.map((key) => fields[key]), id);
      return this.getProfile(id);
    },
    async refreshProfileStatus(id, commandId, status, error) {
      db.prepare("UPDATE profiles SET status=?,error=? WHERE id=? AND command_id=?")
        .run(status, error, id, commandId);
    },
    async claimProfileDownload(id, token, now, leaseUntil) {
      return db.prepare("UPDATE profiles SET download_lock_token=?,download_lock_until=? WHERE id=? AND downloaded=0 AND (download_lock_until IS NULL OR download_lock_until<?)")
        .run(token, leaseUntil, id, now).changes === 1;
    },
    async completeProfileDownload(id, token) {
      return db.prepare("UPDATE profiles SET downloaded=1,download_lock_token=NULL,download_lock_until=NULL WHERE id=? AND download_lock_token=?")
        .run(id, token).changes === 1;
    },
    async releaseProfileDownload(id, token) {
      db.prepare("UPDATE profiles SET download_lock_token=NULL,download_lock_until=NULL WHERE id=? AND download_lock_token=?")
        .run(id, token);
    },
  };
}

function openDynamo(tableName, region) {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const key = (pk) => ({ pk, sk: "META" });
  async function get(pk) {
    return (await client.send(new GetCommand({ TableName: tableName, Key: key(pk), ConsistentRead: true }))).Item;
  }
  return {
    close() {},
    async getUserByEmail(email) {
      const alias = await get(`EMAIL#${email}`);
      return alias ? get(`USER#${alias.userId}`) : undefined;
    },
    async getUserBySessionHash(hash, now) {
      const session = await get(`SESSION#${hash}`);
      if (!session || session.expires <= now) return undefined;
      return get(`USER#${session.userId}`);
    },
    async createLocalUser(user, password) {
      const emailKey = key(`EMAIL#${user.email}`);
      try {
        await client.send(new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: tableName, Item: { ...key(`USER#${user.id}`), ...user, password }, ConditionExpression: "attribute_not_exists(pk)" } },
            { Put: { TableName: tableName, Item: { ...emailKey, userId: user.id }, ConditionExpression: "attribute_not_exists(pk)" } },
          ],
        }));
        return true;
      } catch (error) {
        if (error.name === "TransactionCanceledException") return false;
        throw error;
      }
    },
    async upsertCognitoUser(user) {
      const emailKey = key(`EMAIL#${user.email}`);
      await client.send(new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: tableName, Item: { ...key(`USER#${user.id}`), ...user }, ConditionExpression: "attribute_not_exists(pk) OR email = :email", ExpressionAttributeValues: { ":email": user.email } } },
          { Put: { TableName: tableName, Item: { ...emailKey, userId: user.id }, ConditionExpression: "attribute_not_exists(pk) OR userId = :userId", ExpressionAttributeValues: { ":userId": user.id } } },
        ],
      }));
    },
    async createSession(hash, userId, expires) {
      await client.send(new PutCommand({ TableName: tableName, Item: {
        ...key(`SESSION#${hash}`), userId, expires, ttl: Math.floor(expires / 1000),
      } }));
    },
    async deleteSession(hash) {
      await client.send(new DeleteCommand({ TableName: tableName, Key: key(`SESSION#${hash}`) }));
    },
    async deleteExpiredSessions() {},
    async incrementRateLimit(requestKey, windowMs, now) {
      const bucketStart = Math.floor(now / windowMs) * windowMs;
      const hash = createHash("sha256").update(`${requestKey}:${bucketStart}`).digest("hex");
      const result = await client.send(new UpdateCommand({
        TableName: tableName, Key: key(`RATE#${hash}`),
        UpdateExpression: "SET #count = if_not_exists(#count, :zero) + :one, ttl = :ttl",
        ExpressionAttributeNames: { "#count": "count" },
        ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":ttl": Math.floor((bucketStart + windowMs) / 1000) + 60 },
        ReturnValues: "ALL_NEW",
      }));
      return { totalHits: result.Attributes.count, resetTime: new Date(bucketStart + windowMs) };
    },
    async putOAuth(item) {
      await client.send(new PutCommand({ TableName: tableName, Item: { ...key(`OAUTH#${item.hash}`), ...item, ttl: Math.floor(item.expires / 1000) } }));
    },
    async consumeOAuth(hash, now) {
      try {
        const result = await client.send(new DeleteCommand({
          TableName: tableName,
          Key: key(`OAUTH#${hash}`),
          ConditionExpression: "expires > :now",
          ExpressionAttributeValues: { ":now": now },
          ReturnValues: "ALL_OLD",
        }));
        return result.Attributes;
      } catch (error) {
        if (error.name === "ConditionalCheckFailedException") return undefined;
        throw error;
      }
    },
    async createProfile(profile) {
      const item = {
        ...key(`PROFILE#${profile.id}`), ...profile,
        gsi1pk: `USER#${profile.user_id}`,
        gsi1sk: `${profile.created}#${profile.id}`,
      };
      await client.send(new PutCommand({ TableName: tableName, Item: item, ConditionExpression: "attribute_not_exists(pk)" }));
    },
    async getProfile(id) {
      const item = await get(`PROFILE#${id}`);
      return item && fromDynamoProfile(item);
    },
    async getOwnedProfile(id, userId) {
      const profile = await this.getProfile(id);
      return profile?.user_id === userId ? profile : undefined;
    },
    async listProfiles(userId) {
      const items = [];
      let ExclusiveStartKey;
      do {
        const result = await client.send(new QueryCommand({
          TableName: tableName, IndexName: "user-profiles",
          KeyConditionExpression: "gsi1pk = :user",
          ExpressionAttributeValues: { ":user": `USER#${userId}` },
          ScanIndexForward: false, ExclusiveStartKey,
        }));
        items.push(...(result.Items || []));
        ExclusiveStartKey = result.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return items.map(fromDynamoProfile);
    },
    async countActiveProfiles(userId) {
      return (await this.listProfiles(userId)).filter((profile) => profile.status !== "revoked").length;
    },
    async updateProfile(id, fields) {
      const allowed = new Set(["status", "command_id", "error", "downloaded"]);
      const entries = Object.entries(fields);
      if (entries.some(([name]) => !allowed.has(name))) throw new Error("Invalid profile update");
      if (!entries.length) return this.getProfile(id);
      const names = Object.fromEntries(entries.map(([name], i) => [`#f${i}`, name]));
      const values = Object.fromEntries(entries.map(([, value], i) => [`:v${i}`, value]));
      const update = entries.map(([,], i) => `#f${i} = :v${i}`).join(", ");
      const result = await client.send(new UpdateCommand({
        TableName: tableName, Key: key(`PROFILE#${id}`),
        UpdateExpression: `SET ${update}`,
        ExpressionAttributeNames: names, ExpressionAttributeValues: values,
        ConditionExpression: "attribute_exists(pk)", ReturnValues: "ALL_NEW",
      }));
      return fromDynamoProfile(result.Attributes);
    },
    async refreshProfileStatus(id, commandId, status, error) {
      try {
        await client.send(new UpdateCommand({
          TableName: tableName, Key: key(`PROFILE#${id}`),
          UpdateExpression: "SET #status = :status, #error = :error",
          ConditionExpression: "command_id = :commandId",
          ExpressionAttributeNames: { "#status": "status", "#error": "error" },
          ExpressionAttributeValues: { ":status": status, ":error": error, ":commandId": commandId },
        }));
      } catch (error) {
        if (error.name !== "ConditionalCheckFailedException") throw error;
      }
    },
    async claimProfileDownload(id, token, now, leaseUntil) {
      try {
        await client.send(new UpdateCommand({
          TableName: tableName, Key: key(`PROFILE#${id}`),
          UpdateExpression: "SET downloadLockToken = :token, downloadLockUntil = :until",
          ConditionExpression: "attribute_exists(pk) AND (attribute_not_exists(downloaded) OR downloaded = :zero) AND (attribute_not_exists(downloadLockUntil) OR downloadLockUntil < :now)",
          ExpressionAttributeValues: { ":token": token, ":until": leaseUntil, ":now": now, ":zero": 0 },
        }));
        return true;
      } catch (error) {
        if (error.name === "ConditionalCheckFailedException") return false;
        throw error;
      }
    },
    async completeProfileDownload(id, token) {
      try {
        await client.send(new UpdateCommand({
          TableName: tableName, Key: key(`PROFILE#${id}`),
          UpdateExpression: "SET downloaded = :one REMOVE downloadLockToken, downloadLockUntil",
          ConditionExpression: "downloadLockToken = :token",
          ExpressionAttributeValues: { ":one": 1, ":token": token },
        }));
        return true;
      } catch (error) {
        if (error.name === "ConditionalCheckFailedException") return false;
        throw error;
      }
    },
    async releaseProfileDownload(id, token) {
      try {
        await client.send(new UpdateCommand({
          TableName: tableName, Key: key(`PROFILE#${id}`),
          UpdateExpression: "REMOVE downloadLockToken, downloadLockUntil",
          ConditionExpression: "downloadLockToken = :token",
          ExpressionAttributeValues: { ":token": token },
        }));
      } catch (error) {
        if (error.name !== "ConditionalCheckFailedException") throw error;
      }
    },
  };
}

function fromDynamoProfile(item) {
  if (!item) return undefined;
  const { pk, sk, gsi1pk, gsi1sk, ...profile } = item;
  return profile;
}

export function openStore(dir) {
  return openSqlite(dir);
}

export function createStore({ dataDir, tableName, region }) {
  return tableName ? openDynamo(tableName, region) : openSqlite(dataDir);
}
