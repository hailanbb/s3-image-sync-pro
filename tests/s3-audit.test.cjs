const assert = require("assert");
const fs = require("fs");
const ts = require("typescript");

function loadTsModule(file, moduleRequire = require) {
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", output)(loaded, loaded.exports, moduleRequire);
  return loaded.exports;
}

const {
  CONTENT_SHA256_METADATA_HEADER,
  OPERATION_ID_METADATA_HEADER,
  buildListObjectsV2Query,
  canonicalizeSignedHeaders,
  copyArrayBufferToSafeUint8Array,
  decodeXmlEntities,
  encodeAwsUriComponent,
  encodeS3Key,
  getHeaderCaseInsensitive,
  normalizeContentSha256,
  normalizeLastModified,
  normalizeOperationId,
  parseListObjectsV2Xml,
  resolveFinalContentSha256,
} = loadTsModule("src/s3-audit.ts");

assert.equal(CONTENT_SHA256_METADATA_HEADER, "x-amz-meta-content-sha256");
assert.equal(OPERATION_ID_METADATA_HEADER, "x-amz-meta-s3-image-sync-operation-id");
assert.equal(encodeAwsUriComponent(" !'()*"), "%20%21%27%28%29%2A");
assert.equal(encodeS3Key("a b/中文/!x.webp"), "a%20b/%E4%B8%AD%E6%96%87/%21x.webp");

const query = buildListObjectsV2Query({
  prefix: "06 已归档/a !'()*.jpg",
  continuationToken: "abc+/=&",
  maxKeys: 250,
});
assert.equal(
  query,
  "continuation-token=abc%2B%2F%3D%26&encoding-type=url&list-type=2&max-keys=250&prefix=06%20%E5%B7%B2%E5%BD%92%E6%A1%A3%2Fa%20%21%27%28%29%2A.jpg"
);
assert.throws(() => buildListObjectsV2Query({ maxKeys: 1001 }), /between 1 and 1000/);

const canonical = canonicalizeSignedHeaders({
  "X-Amz-Meta-Content-Sha256": "  ABCD  ",
  Host: "example.test",
  "x-amz-date": "20260830T010203Z",
});
assert.equal(
  canonical.canonicalHeaders,
  "host:example.test\nx-amz-date:20260830T010203Z\nx-amz-meta-content-sha256:ABCD\n"
);
assert.equal(canonical.signedHeaders, "host;x-amz-date;x-amz-meta-content-sha256");

assert.equal(
  getHeaderCaseInsensitive({ ETag: '"abc"', "Content-Length": "42" }, "etag"),
  '"abc"'
);
assert.equal(getHeaderCaseInsensitive({ ETag: '"abc"' }, "last-modified"), null);
const originalBufferBytes = new Uint8Array([1, 2, 3]);
const safeBufferBytes = copyArrayBufferToSafeUint8Array(originalBufferBytes.buffer);
originalBufferBytes[0] = 9;
assert.deepEqual(Array.from(safeBufferBytes), [1, 2, 3]);
assert.notStrictEqual(safeBufferBytes.buffer, originalBufferBytes.buffer);
assert.equal(normalizeContentSha256("A".repeat(64)), "a".repeat(64));
assert.equal(normalizeContentSha256("not-a-hash"), null);
assert.equal(normalizeOperationId(" 123e4567-e89b-12d3-a456-426614174000 "), "123e4567-e89b-12d3-a456-426614174000");
assert.equal(normalizeOperationId("unsafe operation id"), null);
assert.equal(resolveFinalContentSha256("A".repeat(64), "a".repeat(64)), "a".repeat(64));
assert.equal(resolveFinalContentSha256("b".repeat(64), "a".repeat(64)), "a".repeat(64));
assert.throws(() => resolveFinalContentSha256("invalid", "a".repeat(64)), /Invalid precomputed/);
assert.equal(normalizeLastModified("Sun, 30 Aug 2026 01:02:03 GMT"), "2026-08-30T01:02:03.000Z");
assert.equal(decodeXmlEntities("a&amp;b&lt;c&#x2F;&#47;&unknown;"), "a&b<c//&unknown;");

const page = parseListObjectsV2Xml(`<?xml version="1.0" encoding="UTF-8"?>
<s3:ListBucketResult xmlns:s3="http://s3.amazonaws.com/doc/2006-03-01/">
  <s3:EncodingType>url</s3:EncodingType>
  <s3:IsTruncated>true</s3:IsTruncated>
  <s3:Contents>
    <s3:Key>06%20%E5%B7%B2%E5%BD%92%E6%A1%A3%2Fphoto%20%281%29%26x.webp</s3:Key>
    <s3:LastModified>2026-08-30T01:02:03.000Z</s3:LastModified>
    <s3:ETag>&quot;abc123&quot;</s3:ETag>
    <s3:Size>42</s3:Size>
  </s3:Contents>
  <s3:Contents>
    <s3:Key>plain%2Bkey.jpg</s3:Key>
    <s3:LastModified>2026-08-30T02:03:04Z</s3:LastModified>
    <s3:ETag>&quot;def456&quot;</s3:ETag>
    <s3:Size>0</s3:Size>
  </s3:Contents>
  <s3:NextContinuationToken>abc+/=&amp;xyz</s3:NextContinuationToken>
</s3:ListBucketResult>`);

assert.deepEqual(page, {
  objects: [
    {
      key: "06 已归档/photo (1)&x.webp",
      size: 42,
      etag: '"abc123"',
      lastModified: "2026-08-30T01:02:03.000Z",
    },
    {
      key: "plain+key.jpg",
      size: 0,
      etag: '"def456"',
      lastModified: "2026-08-30T02:03:04.000Z",
    },
  ],
  nextContinuationToken: "abc+/=&xyz",
  isTruncated: true,
});

const finalPage = parseListObjectsV2Xml(
  "<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated></ListBucketResult>"
);
assert.deepEqual(finalPage, {
  objects: [],
  nextContinuationToken: null,
  isTruncated: false,
});

assert.throws(
  () => parseListObjectsV2Xml("<ListBucketResult><Contents><Key>a</Key></Contents></ListBucketResult>"),
  /object size is missing or invalid/
);
assert.throws(
  () => parseListObjectsV2Xml("<Error><Code>AccessDenied</Code></Error>"),
  /ListBucketResult is missing or ambiguous/
);

async function testSignedGetObject() {
  const originalActiveWindow = global.activeWindow;
  global.activeWindow = { crypto: globalThis.crypto };
  const cryptoModule = loadTsModule("src/crypto.ts");
  const utilsModule = loadTsModule("src/utils.ts");
  let requestHandler;
  const s3Client = loadTsModule("src/s3-client.ts", (specifier) => {
    if (specifier === "obsidian") {
      return { requestUrl: (options) => requestHandler(options) };
    }
    if (specifier === "./crypto") return cryptoModule;
    if (specifier === "./utils") return utilsModule;
    if (specifier === "./s3-audit") return loadTsModule("src/s3-audit.ts");
    if (specifier === "./types") return {};
    return require(specifier);
  });
  const config = {
    provider: "r2",
    endpoint: "https://account.r2.cloudflarestorage.com/",
    region: "us-east-1",
    bucketName: "images",
    accessKeyId: "ACCESS",
    secretAccessKey: "SECRET",
    customDomainName: "",
    pathTemplate: "",
  };
  const requests = [];
  const responseBytes = new Uint8Array([11, 22, 33]);
  requestHandler = async (options) => {
    requests.push(options);
    return {
      status: 200,
      headers: {
        "Content-TYPE": "image/webp",
        ETag: '"get-etag"',
        "X-Amz-Meta-Content-SHA256": "A".repeat(64),
        "X-Amz-Meta-S3-Image-Sync-Operation-ID": "123e4567-e89b-12d3-a456-426614174000",
      },
      arrayBuffer: responseBytes.buffer,
      text: "",
    };
  };

  const found = await s3Client.getS3Object(config, "06 已归档/a !.webp");
  assert.equal(found.exists, true);
  assert.equal(found.key, "06 已归档/a !.webp");
  assert.deepEqual(Array.from(found.body), [11, 22, 33]);
  assert.equal(found.contentType, "image/webp");
  assert.equal(found.etag, '"get-etag"');
  assert.equal(found.contentSha256, "a".repeat(64));
  assert.equal(found.operationId, "123e4567-e89b-12d3-a456-426614174000");
  responseBytes[0] = 99;
  assert.deepEqual(Array.from(found.body), [11, 22, 33]);
  assert.notStrictEqual(found.body.buffer, responseBytes.buffer);
  assert.equal(requests[0].method, "GET");
  assert.equal(
    requests[0].url,
    "https://account.r2.cloudflarestorage.com/images/06%20%E5%B7%B2%E5%BD%92%E6%A1%A3/a%20%21.webp"
  );
  assert.equal(
    requests[0].headers["x-amz-content-sha256"],
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  assert.match(requests[0].headers.Authorization, /\/auto\/s3\/aws4_request/);
  assert.match(
    requests[0].headers.Authorization,
    /SignedHeaders=host;x-amz-content-sha256;x-amz-date/
  );

  requestHandler = async (options) => {
    requests.push(options);
    return { status: 404, headers: {}, arrayBuffer: new ArrayBuffer(0), text: "" };
  };
  const missing = await s3Client.getS3Object(
    { ...config, provider: "s3", region: "ap-southeast-1" },
    "missing.jpg"
  );
  assert.deepEqual(missing, {
    exists: false,
    key: "missing.jpg",
    body: new Uint8Array(0),
    contentType: null,
    etag: null,
    contentSha256: null,
    operationId: null,
  });
  assert.match(requests.at(-1).headers.Authorization, /\/ap-southeast-1\/s3\/aws4_request/);

  requestHandler = async (options) => {
    requests.push(options);
    return {
      status: 200,
      headers: {
        "Content-Length": "3",
        ETag: '"abc"',
        "Last-Modified": "Sun, 30 Aug 2026 01:02:03 GMT",
        "X-Amz-Meta-Content-Sha256": "b".repeat(64),
        "X-Amz-Meta-S3-Image-Sync-Operation-Id": "head-operation-1",
      },
      arrayBuffer: new ArrayBuffer(0),
      text: "",
    };
  };
  const head = await s3Client.headS3Object(config, "managed/head.webp");
  assert.deepEqual(head, {
    exists: true,
    key: "managed/head.webp",
    size: 3,
    etag: '"abc"',
    lastModified: "2026-08-30T01:02:03.000Z",
    contentSha256: "b".repeat(64),
    operationId: "head-operation-1",
  });

  requestHandler = async (options) => {
    requests.push(options);
    return { status: 412, headers: {}, arrayBuffer: new ArrayBuffer(0), text: "exists" };
  };
  const putResult = await s3Client.putS3Object(
    config,
    "managed/existing.webp",
    new Uint8Array([1, 2, 3]),
    "image/webp",
    (status, text) => `PUT ${status}: ${text}`,
    undefined,
    { ifNoneMatch: true }
  );
  assert.equal(putResult.status, "exists");
  assert.equal(putResult.contentSha256, await cryptoModule.sha256Hex(new Uint8Array([1, 2, 3])));
  assert.match(putResult.operationId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
  assert.equal(requests.at(-1).headers["If-None-Match"], "*");
  assert.equal(
    requests.at(-1).headers["x-amz-meta-s3-image-sync-operation-id"],
    putResult.operationId
  );
  assert.match(requests.at(-1).headers.Authorization, /SignedHeaders=host;if-none-match;/);
  assert.match(requests.at(-1).headers.Authorization, /x-amz-meta-s3-image-sync-operation-id/);
  assert.equal(
    s3Client.isPutOwnershipConfirmed(putResult, putResult.contentSha256, putResult.operationId),
    true
  );
  assert.equal(
    s3Client.isPutOwnershipConfirmed(putResult, putResult.contentSha256, "another-operation"),
    false
  );
  assert.equal(
    s3Client.isPutOwnershipConfirmed(
      { ...putResult, status: "created" },
      putResult.contentSha256,
      null
    ),
    false
  );
  assert.equal(
    s3Client.isPutOwnershipConfirmed(putResult, "f".repeat(64), putResult.operationId),
    false
  );

  let deleteAttempts = 0;
  requestHandler = async (options) => {
    deleteAttempts += 1;
    assert.equal(options.headers["If-Match"], '"owned-etag"');
    assert.match(options.headers.Authorization, /SignedHeaders=host;if-match;/);
    return { status: 503, headers: {}, arrayBuffer: new ArrayBuffer(0), text: "uncertain" };
  };
  await assert.rejects(
    () => s3Client.deleteS3Object(
      { ...config, provider: "s3", region: "ap-southeast-1" },
      "managed/delete.webp",
      '"owned-etag"'
    ),
    /S3 delete failed \(503\): uncertain/
  );
  assert.equal(deleteAttempts, 1);

  requestHandler = async () => {
    deleteAttempts += 1;
    return { status: 412, headers: {}, arrayBuffer: new ArrayBuffer(0), text: "changed" };
  };
  assert.equal(
    await s3Client.deleteS3Object(
      { ...config, provider: "s3", region: "ap-southeast-1" },
      "managed/changed.webp",
      '"owned-etag"'
    ),
    "precondition-failed"
  );
  const attemptsBeforeUnsupported = deleteAttempts;
  assert.equal(
    await s3Client.deleteS3Object(config, "managed/r2-preserved.webp", '"owned-etag"'),
    "unsupported"
  );
  assert.equal(deleteAttempts, attemptsBeforeUnsupported);

  const originalWindow = global.window;
  global.window = { setTimeout: (callback) => callback() };
  try {
    const retriedPutRequests = [];
    requestHandler = async (options) => {
      retriedPutRequests.push(options);
      if (retriedPutRequests.length === 1) {
        // Model a server that committed the create-only PUT but whose response was lost in transit.
        throw new Error("response lost after commit");
      }
      return { status: 412, headers: {}, arrayBuffer: new ArrayBuffer(0), text: "exists" };
    };
    const recoveredPut = await s3Client.putS3Object(
      config,
      "managed/lost-response.webp",
      new Uint8Array([4, 5, 6]),
      "image/webp",
      (status, text) => `PUT ${status}: ${text}`,
      undefined,
      { ifNoneMatch: true }
    );
    assert.equal(recoveredPut.status, "exists");
    assert.equal(retriedPutRequests.length, 2);
    assert.equal(
      retriedPutRequests[0].headers["x-amz-meta-s3-image-sync-operation-id"],
      retriedPutRequests[1].headers["x-amz-meta-s3-image-sync-operation-id"]
    );
    assert.equal(
      retriedPutRequests[1].headers["x-amz-meta-s3-image-sync-operation-id"],
      recoveredPut.operationId
    );
    assert.match(
      retriedPutRequests[0].headers.Authorization,
      /SignedHeaders=host;if-none-match;[^ ]*x-amz-meta-s3-image-sync-operation-id/
    );

    let forbiddenPutAttempts = 0;
    requestHandler = async () => {
      forbiddenPutAttempts += 1;
      return {
        status: 403,
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
        text: "denied",
      };
    };
    await assert.rejects(
      () => s3Client.putS3Object(
        config,
        "managed/forbidden.webp",
        new Uint8Array([7, 8, 9]),
        "image/webp",
        (status, text) => `PUT ${status}: ${text}`,
        undefined,
        { ifNoneMatch: true }
      ),
      /PUT 403: denied/
    );
    assert.equal(forbiddenPutAttempts, 1);

    let attempts = 0;
    requestHandler = async () => {
      attempts += 1;
      if (attempts === 1) {
        return { status: 503, headers: {}, arrayBuffer: new ArrayBuffer(0), text: "busy" };
      }
      return {
        status: 200,
        headers: {},
        arrayBuffer: new Uint8Array([7]).buffer,
        text: "",
      };
    };
    const retried = await s3Client.getS3Object(config, "retry.bin");
    assert.equal(attempts, 2);
    assert.deepEqual(Array.from(retried.body), [7]);

    let forbiddenAttempts = 0;
    requestHandler = async () => {
      forbiddenAttempts += 1;
      return {
        status: 403,
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
        text: "denied",
      };
    };
    await assert.rejects(
      () => s3Client.getS3Object(config, "forbidden.bin"),
      /S3 get failed \(403\): denied/
    );
    assert.equal(forbiddenAttempts, 1);
  } finally {
    global.window = originalWindow;
    global.activeWindow = originalActiveWindow;
  }
}

async function testSerializedSaveQueue() {
  const { SerializedAsyncQueue } = loadTsModule("src/serialized-async-queue.ts");
  const queue = new SerializedAsyncQueue();
  const writes = [];
  const state = { inFlight: false };
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.enqueue(async (revision) => {
    const snapshot = { ...state };
    await firstGate;
    writes.push({ revision, ...snapshot });
  });
  await Promise.resolve();
  state.inFlight = true;
  const marker = queue.enqueue(async (revision) => {
    writes.push({ revision, ...state });
  });
  releaseFirst();
  await Promise.all([first, marker]);

  assert.deepEqual(writes, [
    { revision: 1, inFlight: false },
    { revision: 2, inFlight: true },
  ]);
}

Promise.all([testSignedGetObject(), testSerializedSaveQueue()])
  .then(() => console.log("S3 audit, SigV4, and signed GET tests: passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
