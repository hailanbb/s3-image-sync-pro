import { sha256Hex } from "./crypto";

export type MirrorStatus = "missing" | "same" | "conflict" | "missing-cloud" | "failed" | "downloaded" | "changed";
export interface MirrorEntry {
  key: string;
  localPath: string;
  notePaths: string[];
  status: MirrorStatus;
  hash?: string;
  failure?: "path" | "cloud" | "integrity" | "local" | "create" | "verify";
}
export interface MirrorDownloadPort {
  check(): void;
  readCloud(key: string): Promise<{ body: Uint8Array; contentSha256: string | null } | null>;
  readLocal(path: string): Promise<Uint8Array | null>;
  /** Must recheck scope/cancellation after creating parents; never overwrite. */
  createLocal(entry: MirrorEntry, body: Uint8Array): Promise<void>;
}
export class MirrorTaskStopped extends Error {}
class MirrorIntegrityError extends Error {}

/** Reject paths Windows would normalize or alias; never normalize an S3 key into another key. */
export function mirrorDownloadPath(root: string, key: string): string | null {
  const valid = (path: string): boolean => path.split("/").every((segment) =>
    segment.length > 0 && segment !== "." && segment !== ".." &&
    !/[<>:"\\|?*]/.test(segment) && ![...segment].some((char) => char.charCodeAt(0) < 32) && !/[. ]$/.test(segment) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
  );
  return valid(root) && valid(key) ? `${root}/${key}` : null;
}

async function cloudBytes(port: MirrorDownloadPort, key: string): Promise<{ body: Uint8Array; hash: string } | null> {
  port.check();
  const cloud = await port.readCloud(key);
  port.check();
  if (!cloud) return null;
  const hash = await sha256Hex(cloud.body);
  port.check();
  if (cloud.contentSha256 && cloud.contentSha256 !== hash) throw new MirrorIntegrityError();
  return { body: cloud.body, hash };
}

export async function previewMirrorEntry(port: MirrorDownloadPort, entry: MirrorEntry): Promise<void> {
  let failure: MirrorEntry["failure"] = "cloud";
  try {
    const cloud = await cloudBytes(port, entry.key);
    if (!cloud) { entry.status = "missing-cloud"; return; }
    failure = "local";
    const local = await port.readLocal(entry.localPath);
    port.check();
    entry.hash = cloud.hash;
    entry.status = local === null ? "missing" : await sha256Hex(local) === cloud.hash ? "same" : "conflict";
    port.check();
  } catch (error) {
    if (error instanceof MirrorTaskStopped) throw error;
    entry.status = "failed";
    entry.failure = error instanceof MirrorIntegrityError ? "integrity" : failure;
  }
}

/** Only missing entries are eligible. Refetch bytes, pin preview hash, and never modify existing files. */
export async function restoreMissingMirrorEntry(port: MirrorDownloadPort, entry: MirrorEntry): Promise<void> {
  if (entry.status !== "missing" || !entry.hash) return;
  let failure: MirrorEntry["failure"] = "cloud";
  try {
    const cloud = await cloudBytes(port, entry.key);
    if (!cloud) { entry.status = "missing-cloud"; return; }
    if (cloud.hash !== entry.hash) { entry.status = "changed"; return; }
    failure = "local";
    if (await port.readLocal(entry.localPath) !== null) { entry.status = "changed"; return; }
    port.check();
    failure = "create";
    await port.createLocal(entry, cloud.body);
    // A dispatched write may finish after cancellation; verify and record it before stopping the loop.
    failure = "verify";
    const saved = await port.readLocal(entry.localPath);
    entry.status = saved !== null && await sha256Hex(saved) === cloud.hash ? "downloaded" : "failed";
    if (entry.status === "failed") entry.failure = "verify";
  } catch (error) {
    if (error instanceof MirrorTaskStopped) throw error;
    entry.status = "failed";
    entry.failure = error instanceof MirrorIntegrityError ? "integrity" : failure;
  }
}
