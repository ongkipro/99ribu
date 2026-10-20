import { createHmac } from "node:crypto";

// Independent RFC6238 fixture generator from the enrollment URI. Values stay in
// test process memory; no signing key or MFA material is printed/read from disk.
export function totp(uri: string) {
  const encoded = new URL(uri).searchParams.get("secret") ?? "";
  let bits = "";
  for (const char of encoded.replace(/=+$/, "")) bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return ((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
