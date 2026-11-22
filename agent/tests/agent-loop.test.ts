import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AxiomOrchestrator } from '../src/core/orchestrator.ts';
import { loadConfig } from '../src/llm/config.ts';
import type { LLMCompletionRequest, LLMProvider } from '../src/llm/types.ts';
import { AxiomStore } from '../src/memory/store.ts';
import { createServerApp } from '../src/server/app.ts';

test('End-to-end landing page build, live preview proxy, verification, and memory', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-e2e-'));
  const config = loadConfig({ AXIOM_PROVIDER: 'demo', AXIOM_WORKSPACES_DIR: tmp }, tmp);
  const store = new AxiomStore(':memory:');
  const orchestrator = new AxiomOrchestrator({ config, store });
  const app = createServerApp({ config, orchestrator });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'make me a landing page' }),
    });
    assert.equal(createRes.status, 201);
    const { project, run } = (await createRes.json()) as {
      project: { id: string };
      run: { id: string };
    };

    // Poll until completed
    let latestRun: { status: string; checkpoint?: { lastReview?: { approved: boolean }; lastVerification?: { passed: boolean } } } | undefined;
    for (let i = 0; i < 40; i++) {
      const r = await (await fetch(`${base}/api/runs/${run.id}`)).json() as { run: typeof latestRun };
      latestRun = r.run;
      if (latestRun?.status === 'completed' || latestRun?.status === 'failed') break;
      await new Promise((res) => setTimeout(res, 50));
    }

    assert.equal(latestRun?.status, 'completed');
    assert.equal(latestRun?.checkpoint?.lastVerification?.passed, true);
    assert.equal(latestRun?.checkpoint?.lastReview?.approved, true);

    // Test live reverse-proxied preview URL + asset resolution
    const previewHtml = await fetch(`${base}/preview/${project.id}/`);
    assert.equal(previewHtml.status, 200);
    const htmlText = await previewHtml.text();
    assert.ok(htmlText.includes('<!doctype html>'));

    const previewCss = await fetch(`${base}/preview/${project.id}/styles.css`);
    assert.equal(previewCss.status, 200);
    assert.ok((await previewCss.text()).includes('--accent'));

    assert.ok(store.listMemories().length >= 1);
  } finally {
    await orchestrator.previewManager.stopAll();
    await new Promise((res) => server.close(res));
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Reviewer VETO forces Builder fix iteration before delivery', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-veto-'));
  const config = loadConfig({ AXIOM_PROVIDER: 'demo', AXIOM_WORKSPACES_DIR: tmp, AXIOM_MAX_ITERATIONS: '3' }, tmp);
  const store = new AxiomStore(':memory:');

  let buildCall = 0;
  const vetoTestProvider: LLMProvider = {
    kind: 'demo',
    isOfflineDemo: false,
    async complete(req: LLMCompletionRequest) {
      if (req.role === 'Planner') {
        return {
          text: JSON.stringify({
            goal: 'Build page',
            projectType: 'landing_page',
            options: [
              { id: 'opt-1', title: 'A', summary: 'A', stack: ['HTML'], tradeoffs: 'None' },
              { id: 'opt-2', title: 'B', summary: 'B', stack: ['React'], tradeoffs: 'Heavy' },
            ],
            chosenOptionId: 'opt-1',
            rationaleOneLine: 'Simple wins.',
            steps: ['Write HTML'],
            risks: [],
            edgeCases: [],
            acceptanceCriteria: ['Passes verify_web_app'],
          }),
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, costUsd: 0 },
          model: req.model,
          provider: 'demo',
          stopReason: 'end_turn',
        };
      }
      if (req.role === 'Reviewer') {
        const isFixed = req.messages.some((m) => m.content.includes('"passed":true'));
        return {
          text: JSON.stringify(
            isFixed
              ? { approved: true, vetoed: false, score: 95, summary: 'Fixed cleanly', issues: [] }
              : {
                  approved: false,
                  vetoed: true,
                  score: 40,
                  summary: 'Missing main/h1/viewport',
                  issues: [
                    {
                      severity: 'blocker',
                      category: 'ux',
                      description: 'Failed semantic DOM verification',
                      fixInstruction: 'Add lang, viewport, main, h1, and button',
                    },
                  ],
                },
          ),
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, costUsd: 0 },
          model: req.model,
          provider: 'demo',
          stopReason: 'end_turn',
        };
      }

      // Builder
      const hasVeto = req.messages.some((m) => m.content.includes('REVIEWER_VETO_FIX:'));
      const lastIsTool = req.messages[req.messages.length - 1]?.role === 'tool';
      if (lastIsTool) {
        return {
          text: hasVeto ? 'Fixed all reviewer issues.' : 'Initial pass complete.',
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, costUsd: 0 },
          model: req.model,
          provider: 'demo',
          stopReason: 'end_turn',
        };
      }

      buildCall++;
      if (!hasVeto && buildCall === 1) {
        return {
          text: 'Writing incomplete initial HTML',
          toolCalls: [
            {
              id: 'c1',
              name: 'write_file',
              arguments: { path: 'index.html', content: '<html><body><p>Incomplete</p></body></html>' },
            },
          ],
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, costUsd: 0 },
          model: req.model,
          provider: 'demo',
          stopReason: 'tool_use',
        };
      }

      return {
        text: 'Fixing HTML per reviewer veto',
        toolCalls: [
          {
            id: 'c2',
            name: 'write_file',
            arguments: {
              path: 'index.html',
              content:
                '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fixed</title></head><body><main><h1>Fixed</h1><button>Go</button></main></body></html>',
            },
          },
        ],
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, costUsd: 0 },
        model: req.model,
        provider: 'demo',
        stopReason: 'tool_use',
      };
    },
  };

  const orchestrator = new AxiomOrchestrator({ config, store, providerOverride: vetoTestProvider });
  try {
    const { completion } = orchestrator.startRunAsync({ prompt: 'make me a landing page' });
    const run = await completion;
    assert.equal(run.status, 'completed');
    assert.equal(run.iteration, 2);
    assert.equal(run.checkpoint?.lastReview?.approved, true);
    const logs = store.listActionLogs(run.id);
    assert.ok(logs.some((l) => l.eventType === 'review' && l.summary.includes('VETOED')));
    assert.ok(logs.some((l) => l.eventType === 'review' && l.summary.includes('APPROVED')));
  } finally {
    await orchestrator.previewManager.stopAll();
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Safety confirmation pauses destructive action and executes only on approval', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-confirm-'));
  const config = loadConfig({ AXIOM_PROVIDER: 'demo', AXIOM_WORKSPACES_DIR: tmp }, tmp);
  const store = new AxiomStore(':memory:');
  const orchestrator = new AxiomOrchestrator({ config, store });

  try {
    const { project, completion } = orchestrator.startRunAsync({
      prompt: 'delete everything with rm -rf ./tmp-build',
    });
    const paused = await completion;
    assert.equal(paused.status, 'awaiting_confirmation');

    // Create target dir to confirm execution when approved
    const tmpSub = path.join(project.workspacePath, 'tmp-build');
    fs.mkdirSync(tmpSub, { recursive: true });
    fs.writeFileSync(path.join(tmpSub, 'a.txt'), 'hi');

    const resumed = await orchestrator.confirmRun(paused.id, true);
    assert.equal(resumed.status, 'completed');
    assert.equal(fs.existsSync(tmpSub), false);
  } finally {
    await orchestrator.previewManager.stopAll();
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
