const assert = require("assert");
const fs = require("fs");
const ts = require("typescript");

const source = fs.readFileSync("src/utils.ts", "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const loaded = { exports: {} };
new Function("module", "exports", "require", output)(loaded, loaded.exports, require);

const {
  buildCanonicalNoteKey,
  isKeyReferencedElsewhere,
  renderPathTemplate,
  usesCanonicalNotePathTemplate,
} = loaded.exports;

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

console.log("path-sync and deletion-safety tests: 9 passed");
