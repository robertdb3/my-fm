import { createHash, randomBytes } from "node:crypto";

export function generateSalt(length = 6): string {
  return randomBytes(length).toString("hex");
}

export function createSubsonicToken(password: string, salt: string): string {
  return createHash("md5").update(`${password}${salt}`).digest("hex");
}

export function normalizeBaseUrl(url: string): string {
  // Tolerate hand-typed values: stray whitespace, a dropped slash after the
  // scheme ("https:/host"), and any number of trailing slashes.
  return url
    .trim()
    .replace(/^(https?:)\/*/i, "$1//")
    .replace(/\/+$/, "");
}
