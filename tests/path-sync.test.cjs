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
  cloudKeyFromLocalMirrorPath,
  isKeyReferencedElsewhere,
  renderPathTemplate,
  usesCanonicalNotePathTemplate,
} = loaded;

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

const { extractLocalRefs } = loadTsModule("src/link-parser.ts");
const refs = extractLocalRefs(
  `![[${actualMirrorPath}]]\n![说明](98%20cloudflareR2/path/image.jpg)\n\`![[ignored.jpg]]\``
);
assert.equal(refs.length, 2);
assert.equal(refs[0].kind, "wiki-embed");
assert.equal(refs[0].target, actualMirrorPath);
assert.equal(refs[1].kind, "markdown-embed");
assert.equal(refs[1].target, "98 cloudflareR2/path/image.jpg");

console.log("path-sync, mirror-sync, and deletion-safety tests: 18 passed");
