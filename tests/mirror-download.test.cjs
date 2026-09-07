const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
let modal;
let cloudResponse;
class TFile {}
class ModalMock {
  constructor(app, t, prepare, restore, release) { Object.assign(this, { prepare, restore, release }); modal = this; }
  open() {}
}
function load(file) {
  file = path.resolve(__dirname, '..', file);
  if (cache.has(file)) return cache.get(file);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (id) => {
    if (id === 'obsidian') return { Plugin: class {}, TFile, TFolder: class {}, Notice: class {} };
    if (id === './mirror-download-modal') return { MirrorDownloadModal: ModalMock };
    if (id === './s3-client') return { getS3Object: async () => cloudResponse };
    if (['./utils', './settings', './path-policy', './link-parser', './i18n', './serialized-async-queue', './mirror-download', './crypto'].includes(id)) {
      return load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(file), id + '.ts')));
    }
    return {};
  };
  new Function('module', 'exports', 'require', output)(module, module.exports, localRequire);
  cache.set(file, module.exports);
  return module.exports;
}
const { mirrorDownloadPath, previewMirrorEntry, restoreMissingMirrorEntry, MirrorTaskStopped } = load('src/mirror-download.ts');
const { sha256Hex } = load('src/crypto.ts');
const Plugin = load('src/plugin.ts').default;
const { DEFAULT_SETTINGS } = load('src/settings.ts');
const bytes = (text) => new TextEncoder().encode(text);
const entry = () => ({ key: '06 已归档/测试/图(1)#%.png', localPath: '镜像/06 已归档/测试/图(1)#%.png', notePaths: ['06 已归档/测试.md'], status: 'missing' });

async function fixture(local = null) {
  const state = { cloud: bytes('云端内容'), local, writes: 0, stopped: false, metadata: null };
  const port = {
    check() { if (state.stopped) throw new MirrorTaskStopped(); },
    async readCloud() { return state.cloud === null ? null : { body: state.cloud, contentSha256: state.metadata }; },
    async readLocal() { return state.local; },
    async createLocal(_entry, body) { port.check(); assert.equal(state.local, null); state.local = body.slice(); state.writes++; },
  };
  return { state, port, item: entry() };
}

async function main() {
  assert.equal(mirrorDownloadPath('98 cloudflareR2', '06 已归档/中文/图(1)#%.png'), '98 cloudflareR2/06 已归档/中文/图(1)#%.png');
  for (const invalid of ['', '../x', 'a/../b', '/a', 'a//b', 'a\\b', 'a:', 'a/CON.png', 'a/LPT1', 'a./b', 'a /b', 'a\u0000.png', 'a?b']) {
    assert.equal(mirrorDownloadPath('镜像', invalid), null, invalid);
    assert.equal(mirrorDownloadPath(invalid, 'a.png'), null, invalid);
  }
  let f = await fixture();
  await previewMirrorEntry(f.port, f.item);
  assert.equal(f.item.status, 'missing');
  assert.equal(f.state.writes, 0);
  await restoreMissingMirrorEntry(f.port, f.item);
  assert.equal(f.item.status, 'downloaded');
  assert.equal(f.state.writes, 1);
  assert.equal(await sha256Hex(f.state.local), f.item.hash);
  for (const [local, expected] of [[bytes('云端内容'), 'same'], [bytes('本地更新'), 'conflict']]) {
    f = await fixture(local);
    await previewMirrorEntry(f.port, f.item);
    assert.equal(f.item.status, expected);
    await restoreMissingMirrorEntry(f.port, f.item);
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.local, local);
  }
  for (const kind of ['cloud', 'local']) {
    f = await fixture();
    await previewMirrorEntry(f.port, f.item);
    f.state[kind] = bytes('另一个工具的新版本');
    await restoreMissingMirrorEntry(f.port, f.item);
    assert.equal(f.item.status, 'changed');
    assert.equal(f.state.writes, 0);
  }
  f = await fixture(); f.state.cloud = null;
  await previewMirrorEntry(f.port, f.item);
  assert.equal(f.item.status, 'missing-cloud');
  f = await fixture(); f.state.metadata = 'incorrect';
  await previewMirrorEntry(f.port, f.item);
  assert.equal(f.item.status, 'failed'); assert.equal(f.item.failure, 'integrity');
  f = await fixture();
  f.port.readCloud = async () => { throw new Error('secret response must not enter report'); };
  await previewMirrorEntry(f.port, f.item);
  assert.equal(f.item.failure, 'cloud'); assert.ok(!JSON.stringify(f.item).includes('secret'));
  f = await fixture();
  await previewMirrorEntry(f.port, f.item);
  f.port.readCloud = async () => { f.state.stopped = true; return { body: f.state.cloud, contentSha256: null }; };
  await assert.rejects(() => restoreMissingMirrorEntry(f.port, f.item), MirrorTaskStopped);
  assert.equal(f.state.writes, 0);
  f = await fixture();
  await previewMirrorEntry(f.port, f.item);
  f.port.createLocal = async () => { throw new Error('Destination exists'); };
  await restoreMissingMirrorEntry(f.port, f.item);
  assert.equal(f.item.failure, 'create'); assert.equal(f.state.writes, 0);
  f = await fixture();
  await previewMirrorEntry(f.port, f.item);
  f.port.createLocal = async () => { f.state.local = bytes('corrupt'); };
  await restoreMissingMirrorEntry(f.port, f.item);
  assert.equal(f.item.failure, 'verify'); assert.ok(f.state.local);
  f = await fixture();
  await previewMirrorEntry(f.port, f.item);
  f.port.createLocal = async (_entry, body) => { f.state.local = body; f.state.stopped = true; };
  await restoreMissingMirrorEntry(f.port, f.item);
  assert.equal(f.item.status, 'downloaded', 'Record writes already dispatched before cancellation');

  // Exercise the real plugin adapter, not only the isolated restore engine.
  const makePlugin = () => {
    const plugin = new Plugin();
    plugin.settings = structuredClone(DEFAULT_SETTINGS);
    plugin.settings.enabled = true;
    plugin.locale = 'zh';
    plugin.ensureS3Settings = () => {};
    plugin.getCloudUrlPrefixes = () => ['https://cdn.example/'];
    plugin.extractRemoteUrls = (text) => text === 'reference' ? ['06 已归档/测试/图.png'] : [];
    const note = Object.assign(new TFile(), { path: '06 已归档/测试.md' });
    const files = new Map([[note.path, note]]);
    let noteText = 'reference';
    let writes = 0;
    plugin.app = { vault: {
      getMarkdownFiles: () => [note],
      getAbstractFileByPath: (p) => files.get(p) || null,
      read: async () => noteText,
      readBinary: async (file) => file.body.buffer,
      createBinary: async (p, body) => {
        assert.ok(!files.has(p), 'Must never overwrite'); writes++;
        files.set(p, Object.assign(new TFile(), { path: p, body: new Uint8Array(body) }));
      },
    } };
    plugin.ensureFolderExists = async () => {};
    return { plugin, note, files, setText: (text) => { noteText = text; }, writes: () => writes };
  };
  cloudResponse = { exists: true, body: bytes('图片'), contentSha256: null };
  const preview = async (p) => {
    await p.plugin.downloadCloudToLocal();
    return modal.prepare(() => {}, () => {});
  };
  let p = makePlugin();
  p.files.set('镜像/图.png', Object.assign(new TFile(), { path: '镜像/图.png' }));
  assert.equal(p.plugin.findLocalMirrorForCloudKey('图.webp', '镜像'), null, 'Never substitute another extension');
  assert.equal(p.plugin.findLocalMirrorForCloudKey('图.png', '镜像'), '镜像/图.png');
  p.files.set('镜像/目录.png', {});
  assert.equal(p.plugin.findLocalMirrorForCloudKey('目录.png', '镜像'), null, 'Folders are not images');
  let plan = await preview(p);
  assert.equal(plan.length, 1); assert.equal(p.writes(), 0);
  await modal.restore(plan[0], () => {});
  assert.equal(plan[0].status, 'downloaded'); assert.equal(p.writes(), 1);
  assert.equal(p.plugin.keyOperations.size, 0);
  modal.release(); assert.equal(p.plugin.mirrorDownloadActive, false);
  p = makePlugin(); plan = await preview(p);
  p.setText('removed');
  await modal.restore(plan[0], () => {});
  assert.equal(plan[0].status, 'changed'); assert.equal(p.writes(), 0);
  p = makePlugin(); plan = await preview(p);
  p.plugin.settings.s3.bucketName = 'another-bucket';
  await assert.rejects(() => modal.restore(plan[0], () => {}), MirrorTaskStopped);
  assert.equal(p.writes(), 0);
  p = makePlugin(); plan = await preview(p);
  p.plugin.ensureFolderExists = async () => { p.setText('removed during parent creation'); };
  await modal.restore(plan[0], () => {});
  assert.equal(p.writes(), 0); assert.equal(plan[0].failure, 'create');
  p = makePlugin(); plan = await preview(p);
  p.plugin.ensureFolderExists = async () => { p.plugin.disposed = true; };
  await assert.rejects(() => modal.restore(plan[0], () => {}), MirrorTaskStopped);
  assert.equal(p.writes(), 0); assert.equal(p.plugin.keyOperations.size, 0);
  p = makePlugin(); p.plugin.isIgnoredNote = () => true;
  plan = await preview(p); assert.equal(plan.length, 0);
  console.log('Mirror download tests passed: path safety, read-only preview, conflicts, races, cancellation, integrity, and plugin adapter.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
