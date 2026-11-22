import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AxiomStore } from '../src/memory/store.ts';
import { buildZipBuffer } from '../src/server/zip.ts';
import { registerBuiltinTools } from '../src/tools/builtin.ts';
import { PreviewManager } from '../src/tools/preview.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import { verifyWebApp } from '../src/tools/verifier.ts';

test('verifyWebApp passes on valid semantic site and honestly fails on broken assets/syntax', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-ver-'));
  const store = new AxiomStore(':memory:');
  const preview = new PreviewManager(store);

  try {
    const project = store.createProject({
      name: 'Verify Test',
      slug: 'verify-test',
      workspacePath: tmp,
    });

    // Write valid site
    fs.writeFileSync(
      path.join(tmp, 'index.html'),
      `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ok</title><link rel="stylesheet" href="./styles.css"></head><body><main><h1>Hello</h1><button>Go</button></main><script src="./app.js"></script></body></html>`,
    );
    fs.writeFileSync(path.join(tmp, 'styles.css'), 'body { display: flex; } @media (max-width: 600px) {}');
    fs.writeFileSync(path.join(tmp, 'app.js'), 'console.log("ok");');

    const { port } = await preview.startStaticPreview(project.id, tmp);
    const passReport = await verifyWebApp({
      baseUrl: `http://127.0.0.1:${port}`,
      workspacePath: tmp,
    });
    assert.equal(passReport.passed, true);
    assert.equal(passReport.browserChecked, false);

    // Break asset reference + JS syntax
    fs.writeFileSync(
      path.join(tmp, 'index.html'),
      `<!doctype html><html lang="en"><head><title>Broken</title><link rel="stylesheet" href="./missing.css"></head><body><div>No main or h1</div></body></html>`,
    );
    fs.writeFileSync(path.join(tmp, 'app.js'), 'const bad = ( ;');

    const failReport = await verifyWebApp({
      baseUrl: `http://127.0.0.1:${port}`,
      workspacePath: tmp,
    });
    assert.equal(failReport.passed, false);
    assert.ok(failReport.checks.some((c) => c.category === 'assets' && !c.passed));
    assert.ok(failReport.checks.some((c) => c.category === 'syntax' && !c.passed));
  } finally {
    await preview.stopAll();
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('build_android_apk reports missing JDK/SDK honestly and checks capacitor.config.json', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-apk-'));
  const store = new AxiomStore(':memory:');
  const preview = new PreviewManager(store);
  const registry = new ToolRegistry();
  registerBuiltinTools(registry);
  const apkTool = registry.get('build_android_apk')!;

  try {
    const project = store.createProject({ name: 'APK Test', slug: 'apk-test', workspacePath: tmp });
    const ctx = {
      projectId: project.id,
      runId: 'r-apk',
      workspacePath: tmp,
      store,
      previewManager: preview,
      cmdTimeoutMs: 5000,
    };

    const noCfg = await apkTool.execute({}, ctx);
    assert.equal(noCfg.ok, false);
    assert.match(noCfg.summary, /capacitor\.config\.json/);

    fs.writeFileSync(path.join(tmp, 'capacitor.config.json'), '{"appId":"io.test","webDir":"."}');
    const res = await apkTool.execute({}, ctx);
    assert.equal(res.ok, false);
    assert.match(res.summary, /toolchain unavailable/i);
  } finally {
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildZipBuffer produces valid PKZIP archives readable by standard unzip', async () => {
  const { execFileSync } = await import('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-zip-'));
  try {
    const zipBuf = buildZipBuffer([
      { name: 'index.html', data: Buffer.from('<!doctype html><h1>Zip Test</h1>', 'utf8') },
      { name: 'sub/app.js', data: Buffer.from('console.log(1);', 'utf8') },
    ]);
    assert.equal(zipBuf.subarray(0, 2).toString('utf8'), 'PK');
    const zipPath = path.join(tmp, 'test.zip');
    fs.writeFileSync(zipPath, zipBuf);
    const out = execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' });
    assert.match(out, /No errors detected/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
