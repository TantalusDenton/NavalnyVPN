import { scrypt, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}
export async function checkPassword(password, stored) {
  const [salt, hex] = stored.split(":");
  const candidate = await derive(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return (
    expected.length === candidate.length && timingSafeEqual(expected, candidate)
  );
}
