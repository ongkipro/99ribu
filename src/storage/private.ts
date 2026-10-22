import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { privateDirectory } from "../config/local.ts";

function artifactPath(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new Error("Invalid private artifact identifier.");
  }
  return join(privateDirectory("artifacts"), id);
}

// Authorization belongs to the domain caller; this module exposes no HTTP URL.
export async function savePrivateArtifact(bytes: Uint8Array) {
  const id = randomUUID();
  const file = await open(artifactPath(id), "wx", 0o600);
  try {
    await file.writeFile(bytes);
  } finally {
    await file.close();
  }
  return id;
}

export async function deletePrivateArtifact(id: string) {
  await unlink(artifactPath(id));
}

export async function readPrivateArtifact(id: string) {
  const file = await open(artifactPath(id), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid?.()) {
      throw new Error("Private artifact permissions are invalid.");
    }
    return await file.readFile();
  } finally {
    await file.close();
  }
}
