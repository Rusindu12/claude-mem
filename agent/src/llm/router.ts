import { AxiomNativeProvider } from '../ai/native-provider.ts';
import { AxiomNeuralCore } from '../ai/neural-core.ts';
import { pickModelForTier, type AxiomConfig } from './config.ts';
import { AnthropicProvider } from './providers/anthropic.ts';
import { GeminiProvider } from './providers/gemini.ts';
import { LocalLLMProvider } from './providers/local.ts';
import { OfflineDemoProvider } from './providers/offline-demo.ts';
import { OpenAICompatibleProvider } from './providers/openai.ts';
import type {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMMessage,
  LLMProvider,
  LLMToolDeclaration,
} from './types.ts';
import type { ModelTier, SpecialistRole } from '../shared/types.ts';

export function createProviderFromConfig(
  config: AxiomConfig,
  brain?: AxiomNeuralCore,
): LLMProvider {
  const getBrain = () => brain ?? new AxiomNeuralCore();
  switch (config.activeProvider) {
    case 'anthropic':
      if (!config.anthropicApiKey) return new AxiomNativeProvider(getBrain());
      return new AnthropicProvider(config.anthropicApiKey);
    case 'openai':
      if (!config.openaiApiKey) return new AxiomNativeProvider(getBrain());
      return new OpenAICompatibleProvider(config.openaiApiKey, config.openaiBaseUrl, 'openai');
    case 'gemini':
      if (!config.geminiApiKey) return new AxiomNativeProvider(getBrain());
      return new GeminiProvider(config.geminiApiKey);
    case 'local':
      if (!config.localBaseUrl) return new AxiomNativeProvider(getBrain());
      return new LocalLLMProvider(config.localBaseUrl, config.localApiKey);
    case 'demo':
      return new OfflineDemoProvider();
    case 'axiom-native':
    default:
      return new AxiomNativeProvider(getBrain());
  }
}

export function selectTierForRole(role: SpecialistRole, hardBugEscalation = false): ModelTier {
  if (hardBugEscalation) return 'reasoning';
  if (role === 'Planner' || role === 'Reviewer' || role === 'Researcher') {
    return 'reasoning';
  }
  return 'fast';
}

export interface BudgetState {
  usedTokens: number;
  usedCostUsd: number;
  maxTokens: number;
  maxCostUsd: number;
}

export class ModelRouter {
  readonly provider: LLMProvider;
  private config: AxiomConfig;

  constructor(config: AxiomConfig, providerOverride?: LLMProvider, brain?: AxiomNeuralCore) {
    this.config = config;
    this.provider = providerOverride ?? createProviderFromConfig(config, brain);
  }

  async invoke(params: {
    role: SpecialistRole;
    systemPrompt: string;
    messages: LLMMessage[];
    tools?: LLMToolDeclaration[];
    hardBugEscalation?: boolean;
    jsonMode?: boolean;
    temperature?: number;
    maxTokens?: number;
    budget?: BudgetState;
    maxRetries?: number;
  }): Promise<{ response: LLMCompletionResponse; tier: ModelTier }> {
    if (params.budget) {
      if (params.budget.usedTokens >= params.budget.maxTokens) {
        throw new Error(
          `Token budget exceeded (${params.budget.usedTokens}/${params.budget.maxTokens})`,
        );
      }
      if (params.budget.usedCostUsd >= params.budget.maxCostUsd) {
        throw new Error(
          `Cost budget exceeded ($${params.budget.usedCostUsd.toFixed(4)}/$${params.budget.maxCostUsd.toFixed(2)})`,
        );
      }
    }

    const tier = selectTierForRole(params.role, params.hardBugEscalation);
    const model = pickModelForTier(this.config, tier);
    const maxRetries = params.maxRetries ?? 2;

    const req: LLMCompletionRequest = {
      systemPrompt: params.systemPrompt,
      messages: params.messages,
      tools: params.tools,
      model,
      tier,
      role: params.role,
      jsonMode: params.jsonMode,
      temperature: params.temperature ?? (tier === 'reasoning' ? 0.2 : 0.35),
      maxTokens: params.maxTokens ?? 4096,
      timeoutMs: this.config.llmTimeoutMs,
    };

    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.provider.complete(req);
        if (params.budget) {
          params.budget.usedTokens += response.usage.totalTokens;
          params.budget.usedCostUsd += response.usage.costUsd;
        }
        return { response, tier };
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const retryable =
          /429|500|502|503|504|timeout|abort|ECONNRESET|ETIMEDOUT/i.test(msg);
        if (!retryable || attempt === maxRetries) {
          break;
        }
        const delayMs = Math.min(3000, 350 * 2 ** attempt);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}
