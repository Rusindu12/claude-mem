import type { ModelTier, ProviderKind, SpecialistRole } from '../shared/types.ts';

export interface LLMToolDeclaration {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: LLMToolCall[];
}

export interface LLMCompletionRequest {
  systemPrompt: string;
  messages: LLMMessage[];
  tools?: LLMToolDeclaration[];
  model: string;
  tier: ModelTier;
  role: SpecialistRole;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  timeoutMs: number;
  metadata?: Record<string, unknown>;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface LLMCompletionResponse {
  text: string;
  toolCalls: LLMToolCall[];
  usage: LLMUsage;
  model: string;
  provider: ProviderKind;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
}

export interface LLMProvider {
  readonly kind: ProviderKind;
  readonly isOfflineDemo: boolean;
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;
}
