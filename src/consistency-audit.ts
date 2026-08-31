export type ConsistencyIssueType =
  | "path-mismatch"
  | "missing-local"
  | "missing-cloud"
  | "size-mismatch"
  | "hash-mismatch"
  | "local-orphan"
  | "cloud-orphan"
  | "protected"
  | "ok"
  | "unverified";

export type ConsistencyIssueLocation = "note" | "local" | "cloud" | "both";

export interface NoteObjectReference {
  notePath: string;
  key: string;
  expectedKey?: string;
}

/** A reference that protects an object from orphan cleanup without being audited. */
export interface ProtectionObjectReference {
  notePath: string;
  key: string;
}

export interface LocalObjectRecord {
  key: string;
  size: number;
  hash?: string;
}

export interface CloudObjectRecord {
  key: string;
  size: number;
  etag?: string;
  contentSha256?: string;
}

export interface ConsistencyAuditInput {
  noteRefs: readonly NoteObjectReference[];
  protectionRefs?: readonly ProtectionObjectReference[];
  localObjects: readonly LocalObjectRecord[];
  cloudObjects: readonly CloudObjectRecord[];
  protectedPrefixes?: readonly string[];
}

export interface ConsistencyIssueDetails {
  localSize?: number;
  cloudSize?: number;
  localHash?: string;
  cloudContentSha256?: string;
  cloudEtag?: string;
}

export interface ConsistencyIssue {
  type: ConsistencyIssueType;
  key: string;
  notePaths: string[];
  location: ConsistencyIssueLocation;
  cleanupEligible: boolean;
  expectedKey?: string;
  protectedPrefix?: string;
  details?: ConsistencyIssueDetails;
}

export interface ConsistencyAuditSummary {
  noteReferenceCount: number;
  referencedKeyCount: number;
  localObjectCount: number;
  cloudObjectCount: number;
  resultCount: number;
  issueCount: number;
  cleanupCandidateCount: number;
  counts: Record<ConsistencyIssueType, number>;
}

export interface ConsistencyAuditReport {
  summary: ConsistencyAuditSummary;
  issues: ConsistencyIssue[];
}

const ISSUE_TYPES: readonly ConsistencyIssueType[] = [
  "path-mismatch",
  "missing-local",
  "missing-cloud",
  "size-mismatch",
  "hash-mismatch",
  "local-orphan",
  "cloud-orphan",
  "protected",
  "ok",
  "unverified",
];

/** Normalize a vault-relative path or S3 object key without decoding it. */
export function normalizeAuditKey(value: string): string {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+|\/+$/g, "");
}

function normalizeHash(value: string | undefined): string | undefined {
  const normalized = String(value || "")
    .trim()
    .replace(/^W\//i, "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/^sha-?256\s*[:=]\s*/i, "")
    .toLowerCase();
  return normalized || undefined;
}

function normalizedSize(value: number): number | undefined {
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function matchesPrefix(key: string, prefix: string): boolean {
  return prefix === "" || key === prefix || key.startsWith(`${prefix}/`);
}

function normalizedProtectedPrefixes(prefixes: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const value of prefixes) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    unique.add(raw === "/" || raw === "." ? "" : normalizeAuditKey(raw));
  }
  return [...unique].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

function protectedPrefixFor(key: string, prefixes: readonly string[]): string | undefined {
  const match = prefixes.find((prefix) => matchesPrefix(key, prefix));
  if (match === undefined) return undefined;
  return match || "/";
}

function indexLocalObjects(records: readonly LocalObjectRecord[]): Map<string, LocalObjectRecord> {
  const indexed = new Map<string, LocalObjectRecord>();
  for (const record of records) {
    const key = normalizeAuditKey(record?.key);
    if (!key || indexed.has(key)) continue;
    indexed.set(key, {
      key,
      size: record.size,
      hash: normalizeHash(record.hash),
    });
  }
  return indexed;
}

function indexCloudObjects(records: readonly CloudObjectRecord[]): Map<string, CloudObjectRecord> {
  const indexed = new Map<string, CloudObjectRecord>();
  for (const record of records) {
    const key = normalizeAuditKey(record?.key);
    if (!key || indexed.has(key)) continue;
    indexed.set(key, {
      key,
      size: record.size,
      etag: record.etag,
      contentSha256: normalizeHash(record.contentSha256),
    });
  }
  return indexed;
}

function emptyCounts(): Record<ConsistencyIssueType, number> {
  return Object.fromEntries(ISSUE_TYPES.map((type) => [type, 0])) as Record<
    ConsistencyIssueType,
    number
  >;
}

/**
 * Compare note references, local mirror objects, and cloud objects.
 * This function is deterministic and read-only; it never performs cleanup.
 */
export function auditConsistency(input: ConsistencyAuditInput): ConsistencyAuditReport {
  const localObjects = indexLocalObjects(input.localObjects || []);
  const cloudObjects = indexCloudObjects(input.cloudObjects || []);
  const protectedPrefixes = normalizedProtectedPrefixes(input.protectedPrefixes || []);
  const referencedNotes = new Map<string, Set<string>>();
  const protectionKeys = new Set<string>();
  const uniqueReferences = new Set<string>();
  const issues: ConsistencyIssue[] = [];
  const issueIndex = new Map<string, ConsistencyIssue>();

  const addIssue = (issue: ConsistencyIssue): void => {
    const identity = `${issue.type}\u0000${issue.key}\u0000${issue.expectedKey || ""}`;
    const existing = issueIndex.get(identity);
    if (existing) {
      existing.notePaths = [...new Set([...existing.notePaths, ...issue.notePaths])].sort();
      return;
    }
    issue.notePaths = [...new Set(issue.notePaths)].sort();
    issueIndex.set(identity, issue);
    issues.push(issue);
  };

  for (const ref of input.noteRefs || []) {
    const notePath = normalizeAuditKey(ref?.notePath);
    const key = normalizeAuditKey(ref?.key);
    if (!key) continue;

    const expectedKey = normalizeAuditKey(ref.expectedKey || "");
    uniqueReferences.add(`${notePath}\u0000${key}\u0000${expectedKey}`);

    const notePaths = referencedNotes.get(key) || new Set<string>();
    if (notePath) notePaths.add(notePath);
    referencedNotes.set(key, notePaths);

    if (expectedKey && expectedKey !== key) {
      addIssue({
        type: "path-mismatch",
        key,
        expectedKey,
        notePaths: notePath ? [notePath] : [],
        location: "note",
        cleanupEligible: false,
      });
    }
  }

  for (const ref of input.protectionRefs || []) {
    const key = normalizeAuditKey(ref?.key);
    if (key) protectionKeys.add(key);
  }

  for (const key of [...referencedNotes.keys()].sort()) {
    const notePaths = [...(referencedNotes.get(key) || [])].sort();
    const local = localObjects.get(key);
    const cloud = cloudObjects.get(key);

    if (!local) {
      addIssue({
        type: "missing-local",
        key,
        notePaths,
        location: "local",
        cleanupEligible: false,
      });
    }
    if (!cloud) {
      addIssue({
        type: "missing-cloud",
        key,
        notePaths,
        location: "cloud",
        cleanupEligible: false,
      });
    }
    if (!local || !cloud) continue;

    const localSize = normalizedSize(local.size);
    const cloudSize = normalizedSize(cloud.size);
    const localHash = normalizeHash(local.hash);
    const cloudHash = normalizeHash(cloud.contentSha256);
    const details: ConsistencyIssueDetails = {
      localSize,
      cloudSize,
      localHash,
      cloudContentSha256: cloudHash,
      cloudEtag: cloud.etag,
    };
    let hasMismatch = false;

    if (localSize !== undefined && cloudSize !== undefined && localSize !== cloudSize) {
      hasMismatch = true;
      addIssue({
        type: "size-mismatch",
        key,
        notePaths,
        location: "both",
        cleanupEligible: false,
        details,
      });
    }

    if (localHash && cloudHash && localHash !== cloudHash) {
      hasMismatch = true;
      addIssue({
        type: "hash-mismatch",
        key,
        notePaths,
        location: "both",
        cleanupEligible: false,
        details,
      });
    }

    if (hasMismatch) continue;
    addIssue({
      type: localHash && cloudHash ? "ok" : "unverified",
      key,
      notePaths,
      location: "both",
      cleanupEligible: false,
      details,
    });
  }

  const protectedOrphans = new Map<
    string,
    { prefix: string; locations: Set<"local" | "cloud"> }
  >();
  const registerProtected = (key: string, prefix: string, location: "local" | "cloud"): void => {
    const existing = protectedOrphans.get(key) || { prefix, locations: new Set<"local" | "cloud">() };
    existing.locations.add(location);
    protectedOrphans.set(key, existing);
  };

  for (const key of [...localObjects.keys()].sort()) {
    if (referencedNotes.has(key) || protectionKeys.has(key)) continue;
    const protectedPrefix = protectedPrefixFor(key, protectedPrefixes);
    addIssue({
      type: "local-orphan",
      key,
      notePaths: [],
      location: "local",
      cleanupEligible: protectedPrefix === undefined,
      protectedPrefix,
      details: { localSize: normalizedSize(localObjects.get(key)?.size ?? Number.NaN) },
    });
    if (protectedPrefix !== undefined) registerProtected(key, protectedPrefix, "local");
  }

  for (const key of [...cloudObjects.keys()].sort()) {
    if (referencedNotes.has(key) || protectionKeys.has(key)) continue;
    const protectedPrefix = protectedPrefixFor(key, protectedPrefixes);
    const cloud = cloudObjects.get(key);
    addIssue({
      type: "cloud-orphan",
      key,
      notePaths: [],
      location: "cloud",
      cleanupEligible: protectedPrefix === undefined,
      protectedPrefix,
      details: {
        cloudSize: normalizedSize(cloud?.size ?? Number.NaN),
        cloudContentSha256: normalizeHash(cloud?.contentSha256),
        cloudEtag: cloud?.etag,
      },
    });
    if (protectedPrefix !== undefined) registerProtected(key, protectedPrefix, "cloud");
  }

  for (const [key, protectedOrphan] of [...protectedOrphans.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    addIssue({
      type: "protected",
      key,
      notePaths: [],
      location: protectedOrphan.locations.size === 2 ? "both" : [...protectedOrphan.locations][0],
      cleanupEligible: false,
      protectedPrefix: protectedOrphan.prefix,
    });
  }

  const counts = emptyCounts();
  for (const issue of issues) counts[issue.type] += 1;
  const issueCount = issues.filter((issue) => issue.type !== "ok" && issue.type !== "unverified").length;
  const cleanupCandidateCount = issues.filter((issue) => issue.cleanupEligible).length;

  return {
    summary: {
      noteReferenceCount: uniqueReferences.size,
      referencedKeyCount: referencedNotes.size,
      localObjectCount: localObjects.size,
      cloudObjectCount: cloudObjects.size,
      resultCount: issues.length,
      issueCount,
      cleanupCandidateCount,
      counts,
    },
    issues,
  };
}
