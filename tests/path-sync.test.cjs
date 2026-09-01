const assert = require("assert");
const fs = require("fs");
const ts = require("typescript");

function loadTsModule(file) {
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", output)(loaded, loaded.exports, require);
  return loaded.exports;
}

const loaded = loadTsModule("src/utils.ts");

const {
  buildCanonicalNoteKey,
  buildLinkReplacement,
  buildStorageIdentity,
  cloudKeyFromRecognizedUrl,
  cloudKeyFromLocalMirrorPath,
  cloudUrlPrefixesForStorage,
  isKeyReferencedElsewhere,
  normalizeCloudUrlPrefix,
  normalizeRecognizedCloudDomains,
  renderPathTemplate,
  usesCanonicalNotePathTemplate,
} = loaded;

assert.equal(normalizeCloudUrlPrefix("old-cdn.example.com/"), "https://old-cdn.example.com");
assert.equal(normalizeCloudUrlPrefix("ftp://old-cdn.example.com"), "");
assert.equal(
  cloudKeyFromRecognizedUrl(
    "https://OLD-CDN.example.com/base/06%20%E5%B7%B2%E5%BD%92%E6%A1%A3/A/image.webp?cache=1",
    ["https://old-cdn.example.com/base"]
  ),
  "06 已归档/A/image.webp"
);
assert.equal(
  cloudKeyFromRecognizedUrl(
    "https://cdn.example.com/bucket-two/image.webp",
    ["https://cdn.example.com/bucket"]
  ),
  null
);

const storageConfig = {
  provider: "r2",
  endpoint: "https://ACCOUNT.r2.cloudflarestorage.com/",
  region: "auto",
  bucketName: "bucket-a",
  accessKeyId: "credential-a",
  secretAccessKey: "secret",
  customDomainName: "",
  pathTemplate: "{notedir}/{notename}/{filename}.{ext}",
};
const storageA = buildStorageIdentity(storageConfig, "98 cloudflareR2/");
const storageB = buildStorageIdentity(
  { ...storageConfig, bucketName: "bucket-b" },
  "98 cloudflareR2"
);
assert.notEqual(storageA, storageB);

const recognizedRecords = normalizeRecognizedCloudDomains([
  "https://storage.example.test/bucket-a/",
  { prefix: "https://old-b.example.test/base/", storageIdentity: storageB },
  { prefix: "ftp://invalid.example.test", storageIdentity: storageA },
], storageA);
assert.deepEqual(recognizedRecords, [
  { prefix: "https://storage.example.test/bucket-a", storageIdentity: storageA },
  { prefix: "https://old-b.example.test/base", storageIdentity: storageB },
]);

const prefixesForStorageB = cloudUrlPrefixesForStorage(
  "https://storage.example.test/bucket-b",
  recognizedRecords,
  storageB
);
assert.deepEqual(prefixesForStorageB, [
  "https://storage.example.test/bucket-b",
  "https://old-b.example.test/base",
]);
assert.equal(
  cloudKeyFromRecognizedUrl(
    "https://storage.example.test/bucket-a/06%20已归档/old.webp",
    prefixesForStorageB
  ),
  null
);
assert.equal(
  cloudKeyFromRecognizedUrl(
    "https://old-b.example.test/base/06%20已归档/current.webp",
    prefixesForStorageB
  ),
  "06 已归档/current.webp"
);

assert.equal(
  usesCanonicalNotePathTemplate("{notedir}/{notename}/{filename}.{ext}"),
  true
);
assert.equal(
  usesCanonicalNotePathTemplate("{notedir}\\{notename}\\{filename}.{ext}"),
  true
);
assert.equal(
  usesCanonicalNotePathTemplate("archive/{yyyy}/{filename}.{ext}"),
  false
);
assert.equal(
  usesCanonicalNotePathTemplate("{notedir}/{notename}/assets/{filename}.{ext}"),
  false
);
assert.equal(
  usesCanonicalNotePathTemplate("{notedir}/{notename}/{yyyy}/{filename}.{ext}"),
  false
);
assert.equal(
  usesCanonicalNotePathTemplate("{notedir}/{notename}/fixed.{ext}"),
  false
);
assert.equal(
  buildCanonicalNoteKey("OldNote/image.webp", "", "RootNote"),
  "RootNote/image.webp"
);
assert.equal(
  buildCanonicalNoteKey("Old/Path/OldNote/image.webp", "New/Path", "NewNote"),
  "New/Path/NewNote/image.webp"
);
assert.equal(
  buildCanonicalNoteKey("image.webp", "New/Path", "NewNote"),
  null
);

const references = new Map([
  ["A.md", ["shared/image.webp", "a/image.webp"]],
  ["B.md", ["shared/image.webp"]],
]);
assert.equal(
  isKeyReferencedElsewhere(references, "shared/image.webp", "A.md"),
  true
);
assert.equal(
  isKeyReferencedElsewhere(references, "a/image.webp", "A.md"),
  false
);

const rendered = renderPathTemplate(
  "{yyyy}/{MM}/{dd}/{notedir}/{notename}/{filename}-{hash-short}.{ext}",
  {
    ext: "webp",
    hash: "a".repeat(64),
    hash2: "aa",
    filename: "shot",
    notedir: "Project",
    notename: "Note",
  }
);
assert.match(
  rendered,
  /^\d{4}\/\d{2}\/\d{2}\/Project\/Note\/shot-a{32}\.webp$/
);
assert.equal(
  renderPathTemplate("{notedir}\\{notename}\\{filename}.{ext}", {
    ext: "webp",
    hash: "b".repeat(64),
    hash2: "bb",
    filename: "shot",
    notedir: "06 已归档/常规",
    notename: "示例笔记",
  }),
  "06 已归档/常规/示例笔记/shot.webp"
);

const actualMirrorPath =
  "98 cloudflareR2/01 待阅收件箱/常规/为什么让顾客思考反而更难成交/01_大脑两套系统-88c44ceb5b33a8bf18702984236d8544.jpg";
const actualCloudKey =
  "01 待阅收件箱/常规/为什么让顾客思考反而更难成交/01_大脑两套系统-88c44ceb5b33a8bf18702984236d8544.jpg";
assert.equal(
  cloudKeyFromLocalMirrorPath(actualMirrorPath, "98 cloudflareR2"),
  actualCloudKey
);
assert.equal(
  cloudKeyFromLocalMirrorPath("98 cloudflareR20/a.jpg", "98 cloudflareR2"),
  null
);
assert.equal(
  cloudKeyFromLocalMirrorPath("98 cloudflareR2", "98 cloudflareR2"),
  null
);

const wikiRef = {
  kind: "wiki-embed",
  raw: `![[${actualMirrorPath}]]`,
  start: 0,
  end: actualMirrorPath.length + 5,
  target: actualMirrorPath,
  fragment: "",
  label: "01_大脑两套系统-88c44ceb5b33a8bf18702984236d8544.jpg",
};
assert.equal(
  buildLinkReplacement(wikiRef, "image", "https://img.example.test/path/image.jpg"),
  "![01_大脑两套系统-88c44ceb5b33a8bf18702984236d8544.jpg](https://img.example.test/path/image.jpg)"
);
assert.equal(
  buildLinkReplacement(
    { ...wikiRef, kind: "wiki", raw: `[[${actualMirrorPath}]]` },
    "image",
    "https://img.example.test/path/image.jpg",
    { excalidraw: true }
  ),
  "https://img.example.test/path/image.jpg"
);

const { extractLocalRefs } = loadTsModule("src/link-parser.ts");
const refs = extractLocalRefs(
  `![[${actualMirrorPath}]]\n![说明](98%20cloudflareR2/path/image.jpg)\n\`![[ignored.jpg]]\``
);
assert.equal(refs.length, 2);
assert.equal(refs[0].kind, "wiki-embed");
assert.equal(refs[0].target, actualMirrorPath);
assert.equal(refs[1].kind, "markdown-embed");
assert.equal(refs[1].target, "98 cloudflareR2/path/image.jpg");

const {
  canAudit,
  canMutate,
  canPathSync,
  canCheckPath,
  formatPathPolicyLines,
  getPathMode,
  normalizePolicyPath,
  parsePathPolicyLines,
} = loadTsModule("src/path-policy.ts");

assert.equal(normalizePolicyPath("\\01 待阅收件箱\\常规\\"), "01 待阅收件箱/常规");
assert.equal(normalizePolicyPath("./06 已归档//分类/"), "06 已归档/分类");

const legacyPolicy = {
  processingScopeMode: "legacy",
  excludedNotePaths: ["03 已整理", "\\06 已归档\\"],
  pathPolicies: [{ path: "06 已归档", mode: "managed" }],
};
assert.equal(getPathMode("01 待阅收件箱/笔记.md", legacyPolicy), "managed");
assert.equal(getPathMode("03 已整理/笔记.md", legacyPolicy), "ignore");
assert.equal(getPathMode("060 已归档/笔记.md", legacyPolicy), "managed");
assert.equal(getPathMode("06 已归档\\分类\\笔记.md", legacyPolicy), "ignore");

const scopedPolicy = {
  processingScopeMode: "policy",
  excludedNotePaths: ["07 康果科技"],
  pathPolicies: [
    { path: "01 待阅收件箱", mode: "staging" },
    { path: "06 已归档", mode: "managed" },
    { path: "06 已归档/敏感", mode: "verify" },
    { path: "06 已归档/敏感/私密", mode: "ignore" },
    { path: "07 康果科技", mode: "managed" },
  ],
};
assert.equal(getPathMode("01 待阅收件箱/新笔记.md", scopedPolicy), "staging");
assert.equal(getPathMode("06 已归档/技术/笔记.md", scopedPolicy), "managed");
assert.equal(getPathMode("06 已归档/敏感/笔记.md", scopedPolicy), "verify");
assert.equal(getPathMode("06 已归档/敏感/私密/笔记.md", scopedPolicy), "ignore");
assert.equal(getPathMode("07 康果科技/方案.md", scopedPolicy), "managed");
assert.equal(getPathMode("04 wiki/concepts/概念.md", scopedPolicy), "ignore");

const sameLengthPolicy = {
  processingScopeMode: "policy",
  pathPolicies: [
    { path: "Same", mode: "staging" },
    { path: "Same", mode: "managed" },
    { path: "Same", mode: "verify" },
    { path: "Same", mode: "ignore" },
  ],
};
assert.equal(getPathMode("Same/Note.md", sameLengthPolicy), "ignore");

const rootPolicy = {
  processingScopeMode: "policy",
  pathPolicies: [
    { path: "/", mode: "verify" },
    { path: "06 已归档", mode: "managed" },
  ],
};
assert.equal(getPathMode("Other/Note.md", rootPolicy), "verify");
assert.equal(getPathMode("06 已归档/Note.md", rootPolicy), "managed");

assert.equal(canMutate("ignore"), false);
assert.equal(canMutate("verify"), false);
assert.equal(canMutate("staging"), true);
assert.equal(canMutate("managed"), true);
assert.equal(canPathSync("verify"), false);
assert.equal(canPathSync("staging"), false);
assert.equal(canPathSync("managed"), true);
assert.equal(canCheckPath("ignore"), false);
assert.equal(canCheckPath("staging"), false);
assert.equal(canCheckPath("managed"), true);
assert.equal(canCheckPath("verify"), true);
assert.equal(canAudit("ignore"), false);
assert.equal(canAudit("verify"), true);

const parsedPolicy = parsePathPolicyLines(
  "入箱保护： 01 待阅收件箱\\常规\nmanaged: 06 已归档/\n只读校验: 04 wiki\ninvalid line\nunknown: folder"
);
assert.deepEqual(parsedPolicy, [
  { path: "01 待阅收件箱/常规", mode: "staging" },
  { path: "06 已归档", mode: "managed" },
  { path: "04 wiki", mode: "verify" },
]);
assert.equal(
  formatPathPolicyLines(parsedPolicy),
  "staging: 01 待阅收件箱/常规\nmanaged: 06 已归档\nverify: 04 wiki"
);
assert.deepEqual(parsePathPolicyLines("managed: /"), [{ path: "/", mode: "managed" }]);

const {
  areReferenceSnapshotsEqual,
  isDeletePathModeAuthorized,
  isExactObjectVersion,
  isOwnedVersionEligible,
} = loadTsModule("src/deletion-safety.ts");
const expectedVersion = {
  contentSha256: "a".repeat(64),
  size: 42,
  operationId: "owned-operation-1",
  etag: '"owned-etag-1"',
};
const ownedVersion = {
  key: "managed/image.webp",
  storageIdentity: "r2|account|bucket|mirror|credential",
  ...expectedVersion,
};
assert.equal(
  isExactObjectVersion(expectedVersion, "a".repeat(64), 42, "owned-operation-1", '"owned-etag-1"'),
  true
);
assert.equal(
  isExactObjectVersion(expectedVersion, "a".repeat(64), 43, "owned-operation-1", '"owned-etag-1"'),
  false
);
assert.equal(
  isExactObjectVersion(expectedVersion, "b".repeat(64), 42, "owned-operation-1", '"owned-etag-1"'),
  false
);
assert.equal(
  isExactObjectVersion(expectedVersion, "a".repeat(64), 42, "another-operation", '"owned-etag-1"'),
  false
);
assert.equal(
  isExactObjectVersion(expectedVersion, "a".repeat(64), 42, "owned-operation-1", '"another-etag"'),
  false
);
assert.equal(
  isOwnedVersionEligible(
    ownedVersion.key,
    ownedVersion.storageIdentity,
    expectedVersion,
    ownedVersion
  ),
  true
);
assert.equal(
  isOwnedVersionEligible(ownedVersion.key, "other-storage", expectedVersion, ownedVersion),
  false
);
assert.equal(
  isOwnedVersionEligible(ownedVersion.key, ownedVersion.storageIdentity, undefined, ownedVersion),
  false
);
assert.equal(
  isOwnedVersionEligible(
    ownedVersion.key,
    ownedVersion.storageIdentity,
    expectedVersion,
    { ...ownedVersion, operationId: undefined }
  ),
  false
);
assert.equal(isDeletePathModeAuthorized("path-migration", "managed"), true);
assert.equal(isDeletePathModeAuthorized("path-migration", "staging"), false);
assert.equal(isDeletePathModeAuthorized("note-delete", "staging"), true);
assert.equal(isDeletePathModeAuthorized("startup-missing", "verify"), false);

const stableReferenceSnapshot = [
  { path: "01 待阅收件箱/A.md", mtime: 100, size: 20 },
  { path: "06 已归档/B.md", mtime: 200, size: 30 },
];
assert.equal(
  areReferenceSnapshotsEqual(stableReferenceSnapshot, stableReferenceSnapshot.map((entry) => ({ ...entry }))),
  true
);
assert.equal(
  areReferenceSnapshotsEqual(stableReferenceSnapshot, [
    stableReferenceSnapshot[0],
    { ...stableReferenceSnapshot[1], mtime: 201 },
  ]),
  false
);
assert.equal(areReferenceSnapshotsEqual(stableReferenceSnapshot, stableReferenceSnapshot.slice(0, 1)), false);

const { auditConsistency, normalizeAuditKey } = loadTsModule("src/consistency-audit.ts");

assert.equal(normalizeAuditKey("\\06 已归档\\分类//image.webp/"), "06 已归档/分类/image.webp");

const okHash = "a".repeat(64);
const auditReport = auditConsistency({
  noteRefs: [
    { notePath: "01 待阅收件箱\\A.md", key: "refs\\ok.webp", expectedKey: "refs/ok.webp" },
    { notePath: "01 待阅收件箱/A.md", key: "refs/ok.webp", expectedKey: "refs/ok.webp" },
    { notePath: "06 已归档/B.md", key: "old\\image.webp", expectedKey: "06 已归档/B/image.webp" },
    { notePath: "06 已归档/C.md", key: "refs/missing-local.webp" },
    { notePath: "06 已归档/D.md", key: "refs/missing-cloud.webp" },
    { notePath: "06 已归档/E.md", key: "refs/size.webp" },
    { notePath: "06 已归档/F.md", key: "refs/hash.webp" },
    { notePath: "06 已归档/G.md", key: "refs/unverified.webp" },
  ],
  protectionRefs: [
    { notePath: "03 已整理\\Backup.md", key: "ignored\\referenced.webp" },
    { notePath: "03 已整理/Backup.md", key: "ignored/referenced.webp" },
    { notePath: "03 已整理/Missing.md", key: "ignored/missing-everywhere.webp" },
  ],
  localObjects: [
    { key: "refs/ok.webp", size: 100, hash: okHash.toUpperCase() },
    { key: "refs\\ok.webp", size: 100, hash: okHash },
    { key: "old/image.webp", size: 20 },
    { key: "refs/missing-cloud.webp", size: 30 },
    { key: "refs/size.webp", size: 40, hash: "b".repeat(64) },
    { key: "refs/hash.webp", size: 50, hash: "c".repeat(64) },
    { key: "refs/unverified.webp", size: 60 },
    { key: "temporary\\local-only.webp", size: 70 },
    { key: "mpclipper/shared.webp", size: 80 },
    { key: "ignored\\referenced.webp", size: 85 },
  ],
  cloudObjects: [
    { key: "refs/ok.webp", size: 100, contentSha256: `sha256:${okHash}` },
    { key: "old/image.webp", size: 20, etag: "old-etag" },
    { key: "refs/missing-local.webp", size: 30 },
    { key: "refs/size.webp", size: 41, contentSha256: "b".repeat(64) },
    { key: "refs/hash.webp", size: 50, contentSha256: "d".repeat(64) },
    { key: "refs/unverified.webp", size: 60, etag: "etag-is-not-sha256" },
    { key: "orphan/cloud-only.webp", size: 90 },
    { key: "mpclipper\\shared.webp", size: 80 },
    { key: "ignored/referenced.webp", size: 85 },
  ],
  protectedPrefixes: ["temporary", "mpclipper\\"],
});

assert.equal(auditReport.summary.noteReferenceCount, 7);
assert.equal(auditReport.summary.referencedKeyCount, 7);
assert.equal(auditReport.summary.localObjectCount, 9);
assert.equal(auditReport.summary.cloudObjectCount, 9);
assert.equal(auditReport.summary.resultCount, 14);
assert.equal(auditReport.summary.issueCount, 11);
assert.equal(auditReport.summary.cleanupCandidateCount, 1);
assert.equal(auditReport.summary.counts["path-mismatch"], 1);
assert.equal(auditReport.summary.counts["missing-local"], 1);
assert.equal(auditReport.summary.counts["missing-cloud"], 1);
assert.equal(auditReport.summary.counts["size-mismatch"], 1);
assert.equal(auditReport.summary.counts["hash-mismatch"], 1);
assert.equal(auditReport.summary.counts["local-orphan"], 2);
assert.equal(auditReport.summary.counts["cloud-orphan"], 2);
assert.equal(auditReport.summary.counts.protected, 2);
assert.equal(auditReport.summary.counts.ok, 1);
assert.equal(auditReport.summary.counts.unverified, 2);

const pathMismatch = auditReport.issues.find((issue) => issue.type === "path-mismatch");
assert.equal(pathMismatch.key, "old/image.webp");
assert.equal(pathMismatch.expectedKey, "06 已归档/B/image.webp");

const protectedLocal = auditReport.issues.find(
  (issue) => issue.type === "local-orphan" && issue.key === "temporary/local-only.webp"
);
assert.equal(protectedLocal.cleanupEligible, false);
assert.equal(protectedLocal.protectedPrefix, "temporary");

const protectedShared = auditReport.issues.find(
  (issue) => issue.type === "protected" && issue.key === "mpclipper/shared.webp"
);
assert.equal(protectedShared.location, "both");
assert.equal(protectedShared.cleanupEligible, false);

const cloudCleanupCandidate = auditReport.issues.find(
  (issue) => issue.type === "cloud-orphan" && issue.key === "orphan/cloud-only.webp"
);
assert.equal(cloudCleanupCandidate.cleanupEligible, true);

const verified = auditReport.issues.find((issue) => issue.type === "ok");
assert.equal(verified.key, "refs/ok.webp");
assert.deepEqual(verified.notePaths, ["01 待阅收件箱/A.md"]);

assert.equal(
  auditReport.issues.some((issue) => issue.key.startsWith("ignored/")),
  false
);

const protectionOnlyReport = auditConsistency({
  noteRefs: [],
  protectionRefs: [{ notePath: "03 已整理/Only.md", key: "protected-by-note/image.webp" }],
  localObjects: [{ key: "protected-by-note\\image.webp", size: 10 }],
  cloudObjects: [{ key: "protected-by-note/image.webp", size: 10 }],
});
assert.equal(protectionOnlyReport.summary.noteReferenceCount, 0);
assert.equal(protectionOnlyReport.summary.referencedKeyCount, 0);
assert.equal(protectionOnlyReport.summary.resultCount, 0);
assert.equal(protectionOnlyReport.summary.cleanupCandidateCount, 0);

console.log("path, mirror, URL history, deletion-safety, policy, and consistency-audit tests: passed");
