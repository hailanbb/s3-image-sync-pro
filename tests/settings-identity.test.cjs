const assert = require("assert");
const fs = require("fs");
const ts = require("typescript");

require.extensions[".ts"] = function transpileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  module._compile(output, filename);
};

const { DEFAULT_SETTINGS, mergeSettings } = require("../src/settings.ts");
const {
  buildStorageIdentity,
  cloudKeyFromRecognizedUrl,
  cloudUrlPrefixesForStorage,
} = require("../src/utils.ts");

const s3A = {
  ...DEFAULT_SETTINGS.s3,
  endpoint: "https://account.r2.cloudflarestorage.com",
  bucketName: "bucket-a",
  accessKeyId: "credential-a",
};
const loadedLegacy = mergeSettings(DEFAULT_SETTINGS, {
  s3: s3A,
  localMirrorRoot: "98 cloudflareR2",
  recognizedCloudDomains: ["https://cdn-a.example.test/old-base/"],
});
const identityA = buildStorageIdentity(s3A, "98 cloudflareR2");
assert.deepEqual(loadedLegacy.recognizedCloudDomains, [{
  prefix: "https://cdn-a.example.test/old-base",
  storageIdentity: identityA,
}]);

const s3B = { ...s3A, bucketName: "bucket-b" };
const loadedAfterBucketSwitch = mergeSettings(DEFAULT_SETTINGS, {
  ...loadedLegacy,
  s3: s3B,
});
const identityB = buildStorageIdentity(s3B, "98 cloudflareR2");
assert.notEqual(identityA, identityB);
assert.equal(
  loadedAfterBucketSwitch.recognizedCloudDomains[0].storageIdentity,
  identityA
);

const prefixesForB = cloudUrlPrefixesForStorage(
  "https://account.r2.cloudflarestorage.com/bucket-b",
  loadedAfterBucketSwitch.recognizedCloudDomains,
  identityB
);
assert.equal(
  cloudKeyFromRecognizedUrl(
    "https://cdn-a.example.test/old-base/06%20已归档/image.webp",
    prefixesForB
  ),
  null
);

const r2DeleteSettings = mergeSettings(DEFAULT_SETTINGS, {
  s3: s3A,
  deleteRemoteOnNoteDelete: true,
  deleteOldObjectAfterPathMigration: true,
});
assert.equal(r2DeleteSettings.deleteRemoteOnNoteDelete, false);
assert.equal(r2DeleteSettings.deleteOldObjectAfterPathMigration, false);

const awsDeleteSettings = mergeSettings(DEFAULT_SETTINGS, {
  s3: { ...s3A, provider: "s3", region: "ap-southeast-1" },
  deleteRemoteOnNoteDelete: true,
  deleteOldObjectAfterPathMigration: true,
});
assert.equal(awsDeleteSettings.deleteRemoteOnNoteDelete, true);
assert.equal(awsDeleteSettings.deleteOldObjectAfterPathMigration, true);

console.log("settings identity and provider delete-capability tests: passed");
