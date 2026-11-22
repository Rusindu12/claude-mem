import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/llm/config.ts';
import { ModelRouter, selectTierForRole } from '../src/llm/router.ts';
import type { LLMCompletionRequest, LLMProvider } from '../src/llm/types.ts';

test('loadConfig reads models and provider selection from env without hardcoded secrets', () => {
  const cfgDefault = loadConfig({});
  assert.equal(cfgDefault.activeProvider, 'axiom-native');

  const cfgAnthropic = loadConfig({
    AXIOM_PROVIDER: 'auto',
    ANTHROPIC_API_KEY: 'test-key-value',
    ANTHROPIC_REASONING_MODEL: 'claude-opus-test',
    ANTHROPIC_FAST_MODEL: 'claude-haiku-test',
  });
  assert.equal(cfgAnthropic.activeProvider, 'anthropic');
  assert.equal(cfgAnthropic.reasoningModel, 'claude-opus-test');
  assert.equal(cfgAnthropic.fastModel, 'claude-haiku-test');
});

test('ModelRouter routes Planner/Reviewer to reasoning tier, Builder to fast, and escalates hard bugs', async () => {
  assert.equal(selectTierForRole('Planner'), 'reasoning');
  assert.equal(selectTierForRole('Reviewer'), 'reasoning');
  assert.equal(selectTierForRole('Builder'), 'fast');
  assert.equal(selectTierForRole('Builder', true), 'reasoning');

  const observedModels: string[] = [];
  let failOnce = true;

  const stubProvider: LLMProvider = {
    kind: 'openai',
    isOfflineDemo: false,
    async complete(req: LLMCompletionRequest) {
      observedModels.push(req.model);
      if (failOnce) {
        failOnce = false;
        throw new Error('openai API error (503): transient overload');
      }
      return {
        text: 'ok',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, costUsd: 0.001 },
        model: req.model,
        provider: 'openai',
        stopReason: 'end_turn',
      };
    },
  };

  const config = loadConfig({
    AXIOM_PROVIDER: 'openai',
    OPENAI_API_KEY: 'dummy',
    OPENAI_REASONING_MODEL: 'deep-reasoner',
    OPENAI_FAST_MODEL: 'quick-worker',
  });

  const router = new ModelRouter(config, stubProvider);
  const budget = { usedTokens: 0, usedCostUsd: 0, maxTokens: 50, maxCostUsd: 1 };

  const r1 = await router.invoke({
    role: 'Planner',
    systemPrompt: 'sys',
    messages: [{ role: 'user', content: 'plan' }],
    budget,
  });
  assert.equal(r1.tier, 'reasoning');
  assert.deepEqual(observedModels, ['deep-reasoner', 'deep-reasoner']);

  const r2 = await router.invoke({
    role: 'Builder',
    systemPrompt: 'sys',
    messages: [{ role: 'user', content: 'build' }],
    budget,
  });
  assert.equal(r2.tier, 'fast');
  assert.equal(observedModels[2], 'quick-worker');

  // Exceeds token budget (used 40, still < 50, next check triggers after adding)
  budget.usedTokens = 50;
  await assert.rejects(
    () =>
      router.invoke({
        role: 'Builder',
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'over' }],
        budget,
      }),
    /Token budget exceeded/,
  );
});
