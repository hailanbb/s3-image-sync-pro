import type { ObjectVersionRecord, OwnedObjectRecord } from "./types";
import type { PathMode } from "./path-policy";

export interface ReferenceSnapshotEntry {
  path: string;
  mtime: number;
  size: number;
}

export function isExactObjectVersion(
  expected: ObjectVersionRecord | undefined,
  contentSha256: string,
  size: number,
  operationId: string | null,
  etag: string | null
): boolean {
  return !!expected &&
    expected.contentSha256 === contentSha256 &&
    expected.size === size &&
    expected.operationId === operationId &&
    expected.etag === etag;
}

export function isOwnedVersionEligible(
  key: string,
  storageIdentity: string,
  expected: ObjectVersionRecord | undefined,
  owned: OwnedObjectRecord | null | undefined
): boolean {
  return !!owned &&
    owned.key === key &&
    owned.storageIdentity === storageIdentity &&
    typeof owned.contentSha256 === "string" &&
    typeof owned.size === "number" &&
    typeof owned.operationId === "string" &&
    typeof owned.etag === "string" &&
    isExactObjectVersion(
      expected,
      owned.contentSha256,
      owned.size,
      owned.operationId,
      owned.etag
    );
}

export function isDeletePathModeAuthorized(
  reason: "note-delete" | "startup-missing" | "path-migration",
  mode: PathMode
): boolean {
  return reason === "path-migration"
    ? mode === "managed"
    : mode === "staging" || mode === "managed";
}

export function areReferenceSnapshotsEqual(
  before: readonly ReferenceSnapshotEntry[],
  after: readonly ReferenceSnapshotEntry[]
): boolean {
  if (before.length !== after.length) return false;
  for (let index = 0; index < before.length; index++) {
    const left = before[index];
    const right = after[index];
    if (
      left.path !== right.path ||
      left.mtime !== right.mtime ||
      left.size !== right.size
    ) {
      return false;
    }
  }
  return true;
}
