import path from 'node:path';
import type { ModelTier, ProviderKind, ProviderStatusInfo } from '../shared/types.ts';

export interface AxiomConfig {
  providerSelection: ProviderKind | 'auto';
  activeProvider: ProviderKind;
  configuredProviders: ProviderKind[];
  reasoningModel: string;
  fastModel: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openaiBaseUrl: string;
  geminiApiKey?: string;
  localBaseUrl?: string;
  localApiKey: string;
  port: number;
  apiPort: number;
  host: string;
  dataDir: string;
  workspacesDir: string;
  pluginsConfigPath: string;
  maxIterations: number;
  maxToolSteps: number;
  maxTokensPerRun: number;
  maxCostUsdPerRun: number;
  llmTimeoutMs: number;
  cmdTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, rootDir = process.cwd()): AxiomConfig {
  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim() || undefined;
  const openaiApiKey = env.OPENAI_API_KEY?.trim() || undefined;
  const geminiApiKey = env.GEMINI_API_KEY?.trim() || undefined;
  const localBaseUrl = env.LOCAL_LLM_BASE_URL?.trim() || undefined;

  const configuredProviders: ProviderKind[] = [];
  if (anthropicApiKey) configuredProviders.push('anthropic');
  if (openaiApiKey) configuredProviders.push('openai');
  if (geminiApiKey) configuredProviders.push('gemini');
  if (localBaseUrl) configuredProviders.push('local');

  const rawSelection = (env.AXIOM_PROVIDER?.trim().toLowerCase() || 'auto') as ProviderKind | 'auto';

  let activeProvider: ProviderKind;
  if (rawSelection === 'auto') {
    activeProvider = configuredProviders[0] ?? 'axiom-native';
  } else if (rawSelection === 'axiom-native' || rawSelection === 'demo') {
    activeProvider = rawSelection;
  } else if (configuredProviders.includes(rawSelection)) {
    activeProvider = rawSelection;
  } else {
    // Fall back safely if requested provider lacks credentials
    activeProvider = configuredProviders[0] ?? 'axiom-native';
  }

  const defaults = getDefaultModels(activeProvider, env);
  const reasoningModel = env.AXIOM_REASONING_MODEL?.trim() || defaults.reasoning;
  const fastModel = env.AXIOM_FAST_MODEL?.trim() || defaults.fast;

  return {
    providerSelection: rawSelection,
    activeProvider,
    configuredProviders,
    reasoningModel,
    fastModel,
    anthropicApiKey,
    openaiApiKey,
    openaiBaseUrl: env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
    geminiApiKey,
    localBaseUrl,
    localApiKey: env.LOCAL_LLM_API_KEY?.trim() || 'local',
    port: Number(env.PORT || 3000),
    apiPort: Number(env.API_PORT || 3001),
    host: env.HOST?.trim() || '0.0.0.0',
    dataDir: path.resolve(rootDir, env.AXIOM_DATA_DIR?.trim() || './data'),
    workspacesDir: path.resolve(rootDir, env.AXIOM_WORKSPACES_DIR?.trim() || './workspaces'),
    pluginsConfigPath: path.resolve(rootDir, env.AXIOM_PLUGINS_CONFIG?.trim() || './plugins/plugins.json'),
    maxIterations: Math.max(1, Number(env.AXIOM_MAX_ITERATIONS || 4)),
    maxToolSteps: Math.max(4, Number(env.AXIOM_MAX_TOOL_STEPS || 18)),
    maxTokensPerRun: Math.max(5000, Number(env.AXIOM_MAX_TOKENS_PER_RUN || 180000)),
    maxCostUsdPerRun: Math.max(0.05, Number(env.AXIOM_MAX_COST_USD_PER_RUN || 2.5)),
    llmTimeoutMs: Math.max(3000, Number(env.AXIOM_LLM_TIMEOUT_MS || 45000)),
    cmdTimeoutMs: Math.max(2000, Number(env.AXIOM_CMD_TIMEOUT_MS || 30000)),
  };
}

function getDefaultModels(
  provider: ProviderKind,
  env: NodeJS.ProcessEnv,
): { reasoning: string; fast: string } {
  switch (provider) {
    case 'anthropic':
      return {
        reasoning: env.ANTHROPIC_REASONING_MODEL?.trim() || 'claude-sonnet-4-5',
        fast: env.ANTHROPIC_FAST_MODEL?.trim() || 'claude-haiku-4-5',
      };
    case 'openai':
      return {
        reasoning: env.OPENAI_REASONING_MODEL?.trim() || 'gpt-5',
        fast: env.OPENAI_FAST_MODEL?.trim() || 'gpt-5-mini',
      };
    case 'gemini':
      return {
        reasoning: env.GEMINI_REASONING_MODEL?.trim() || 'gemini-2.5-pro',
        fast: env.GEMINI_FAST_MODEL?.trim() || 'gemini-2.5-flash',
      };
    case 'local':
      return {
        reasoning: env.LOCAL_LLM_REASONING_MODEL?.trim() || 'qwen2.5-coder:32b',
        fast: env.LOCAL_LLM_FAST_MODEL?.trim() || 'qwen2.5-coder:7b',
      };
    case 'axiom-native':
      return {
        reasoning: 'axiom-neural-architect-v1',
        fast: 'axiom-neural-builder-v1',
      };
    case 'demo':
      return {
        reasoning: 'axiom-offline-architect-v1',
        fast: 'axiom-offline-builder-v1',
      };
  }
}

export function pickModelForTier(config: AxiomConfig, tier: ModelTier): string {
  return tier === 'reasoning' ? config.reasoningModel : config.fastModel;
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const m = model.toLowerCase();
  if (m.includes('axiom-neural') || m.includes('offline') || m.includes('qwen') || m.includes('llama') || m.includes('local')) {
    return 0;
  }
  // Approximate per-1M token pricing for budget tracking
  let inRate = 2.0;
  let outRate = 8.0;
  if (m.includes('haiku') || m.includes('mini') || m.includes('flash')) {
    inRate = 0.35;
    outRate = 1.4;
  } else if (m.includes('opus') || m.includes('pro')) {
    inRate = 3.5;
    outRate = 15.0;
  }
  return Number(((inputTokens * inRate + outputTokens * outRate) / 1_000_000).toFixed(6));
}

export function toProviderStatus(config: AxiomConfig): ProviderStatusInfo {
  return {
    activeProvider: config.activeProvider,
    isOfflineDemo: config.activeProvider === 'demo',
    reasoningModel: config.reasoningModel,
    fastModel: config.fastModel,
    configuredProviders: config.configuredProviders,
    budgets: {
      maxIterations: config.maxIterations,
      maxToolSteps: config.maxToolSteps,
      maxTokensPerRun: config.maxTokensPerRun,
      maxCostUsdPerRun: config.maxCostUsdPerRun,
    },
  };
}
