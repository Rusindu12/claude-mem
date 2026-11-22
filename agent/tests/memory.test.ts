import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AxiomStore } from '../src/memory/store.ts';

test('AxiomStore persists projects, runs, checkpoints, action logs, and long-term memory', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-mem-'));
  const store = new AxiomStore(':memory:');

  try {
    const project = store.createProject({
      name: 'Landing Test',
      slug: 'landing-test',
      workspacePath: path.join(tmp, 'ws'),
    });
    assert.ok(fs.existsSync(project.workspacePath));

    const run = store.createRun({
      projectId: project.id,
      prompt: 'make me a landing page',
      language: 'en',
      provider: 'demo',
      isOfflineDemo: true,
      reasoningModel: 'r-model',
      fastModel: 'f-model',
    });

    store.updateRunState(run.id, {
      currentPhase: 'act',
      iteration: 1,
      totalTokens: 500,
      checkpoint: { phase: 'act', iteration: 1, stepCount: 2 },
    });

    const loadedRun = store.getRun(run.id)!;
    assert.equal(loadedRun.currentPhase, 'act');
    assert.equal(loadedRun.checkpoint?.stepCount, 2);

    store.appendActionLog({
      runId: run.id,
      role: 'Planner',
      phase: 'plan',
      eventType: 'plan',
      summary: 'Planned 3 options',
      status: 'ok',
      durationMs: 12,
      tokensUsed: 200,
      costUsd: 0,
    });
    assert.equal(store.listActionLogs(run.id).length, 1);

    store.upsertProjectNote(project.id, 'stack', 'Vite + React');
    assert.equal(store.listProjectNotes(project.id)[0].content, 'Vite + React');

    store.addMemory({
      category: 'lesson',
      title: 'Use relative asset paths',
      content: 'Use ./styles.css for proxy-compatible preview URLs',
      tags: ['preview', 'css'],
    });

    const hits = store.searchMemories('relative preview css', 5);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].title, 'Use relative asset paths');
    assert.equal(store.listMemories()[0].hits, 1);
  } finally {
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
