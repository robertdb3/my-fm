import { createHash, randomBytes } from "node:crypto";

export function generateSalt(length = 6): string {
  return randomBytes(length).toString("hex");
}

export function createSubsonicToken(password: string, salt: string): string {
  return createHash("md5").update(`${password}${salt}`).digest("hex");
}

export function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
