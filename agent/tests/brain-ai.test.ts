import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileBrainStorage } from '../src/ai/brain-storage.ts';
import { AxiomNeuralCore } from '../src/ai/neural-core.ts';
import { parsePromptWithBrain } from '../src/ai/semantic-parser.ts';
import { AxiomOrchestrator } from '../src/core/orchestrator.ts';
import { loadConfig } from '../src/llm/config.ts';
import { AxiomStore } from '../src/memory/store.ts';
import { createServerApp } from '../src/server/app.ts';

test('AxiomNeuralCore trains cleanly, persists to disk, and supports online learning', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-brain-'));
  const brainFile = path.join(tmp, 'axiom-brain.json');

  try {
    const brain = new AxiomNeuralCore(createFileBrainStorage(brainFile));
    const status = brain.getStatus();
    assert.ok(status.trainAccuracy >= 0.9, `Expected >=0.9 accuracy, got ${status.trainAccuracy}`);
    assert.ok(fs.existsSync(brainFile));

    const cls3d = brain.classify('make a 3D open world city game with cars and NPC traffic');
    assert.equal(cls3d.intent, 'game_3d');
    assert.ok(cls3d.confidence > 0.5);

    const clsSinglish = brain.classify('mata coffee shop ekakata lassana landing page ekak hadanna');
    assert.equal(clsSinglish.intent, 'landing_page');

    const clsSinhala = brain.classify('රෝගීන්ගේ වේලාවන් වෙන්කරන පද්ධතියක් හදන්න');
    assert.equal(clsSinhala.intent, 'crud_app');

    brain.learnOnline('build a sleek cyber showroom homepage', 'landing_page');
    assert.equal(brain.getStatus().onlineUpdates, 1);

    // Reload persisted weights cleanly
    const reloaded = new AxiomNeuralCore(createFileBrainStorage(brainFile));
    assert.equal(reloaded.getStatus().onlineUpdates, 1);
    assert.equal(reloaded.classify('make a 3D city driving game').intent, 'game_3d');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('parsePromptWithBrain extracts domain entities and follow-up edit signals', () => {
  const brain = new AxiomNeuralCore();

  const hosp = parsePromptWithBrain(
    'build a hospital patient appointment booking tracker with search and CSV export',
    brain,
  );
  assert.equal(hosp.intent, 'crud_app');
  assert.equal(hosp.domain, 'healthcare');
  assert.equal(hosp.entity.singular, 'Appointment');
  assert.equal(hosp.features.wantsCsvExport, true);

  const followup = parsePromptWithBrain(
    'change theme to light mode and rename brand to NovaGrid',
    brain,
    { hasExistingWorkspaceFiles: true },
  );
  assert.equal(followup.intent, 'followup_edit');
  assert.equal(followup.editSignals.switchTheme, 'light');
  assert.equal(followup.editSignals.newBrand, 'NovaGrid');
});

test('Axiom Native AI builds playable 3D Three.js vertical slice and serves local vendor modules', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-3d-'));
  const config = loadConfig(
    { AXIOM_PROVIDER: 'axiom-native', AXIOM_WORKSPACES_DIR: tmp, AXIOM_DATA_DIR: tmp },
    tmp,
  );
  const store = new AxiomStore(':memory:');
  const orchestrator = new AxiomOrchestrator({ config, store });
  const app = createServerApp({ config, orchestrator });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));

  try {
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    const { project, completion } = orchestrator.startRunAsync({
      prompt: 'make a GTA style 3D city driving game in Three.js with minimap and mission',
    });
    const run = await completion;
    assert.equal(run.status, 'completed');
    assert.equal(run.provider, 'axiom-native');
    assert.equal(run.checkpoint?.lastVerification?.passed, true);

    const vendorRes = await fetch(`${base}/preview/${project.id}/vendor/three.module.js`);
    assert.equal(vendorRes.status, 200);
    assert.ok((await vendorRes.text()).includes('PerspectiveCamera'));

    const brainRes = await (await fetch(`${base}/api/brain`)).json() as {
      brain: { onlineUpdates: number };
    };
    assert.ok(brainRes.brain.onlineUpdates >= 1);
  } finally {
    await orchestrator.previewManager.stopAll();
    await new Promise((r) => server.close(r));
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
