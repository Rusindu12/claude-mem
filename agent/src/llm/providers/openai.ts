import { estimateCostUsd } from '../config.ts';
import type {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMMessage,
  LLMProvider,
  LLMToolCall,
} from '../types.ts';
import type { ProviderKind } from '../../shared/types.ts';

function toOpenAIMessages(
  systemPrompt: string,
  messages: LLMMessage[],
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{ role: 'system', content: systemPrompt }];
  for (const msg of messages) {
    if (msg.role === 'user') {
      out.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      const entry: Record<string, unknown> = {
        role: 'assistant',
        content: msg.content || null,
      };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        entry.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }
      out.push(entry);
    } else if (msg.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: msg.toolCallId ?? 'call-0',
        content: msg.content,
      });
    }
  }
  return out;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly kind: ProviderKind;
  readonly isOfflineDemo = false;
  private apiKey: string;
  private baseUrl: string;

  constructor(
    apiKey: string,
    baseUrl = 'https://api.openai.com/v1',
    kind: ProviderKind = 'openai',
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.kind = kind;
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      const body: Record<string, unknown> = {
        model: request.model,
        messages: toOpenAIMessages(request.systemPrompt, request.messages),
      };

      if (request.maxTokens) {
        body.max_tokens = request.maxTokens;
      }
      if (typeof request.temperature === 'number') {
        body.temperature = request.temperature;
      }
      if (request.jsonMode) {
        body.response_format = { type: 'json_object' };
      }
      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        }));
      }

      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (this.apiKey) {
        headers.authorization = `Bearer ${this.apiKey}`;
      }

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const payload = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const msg =
          typeof (payload.error as Record<string, unknown> | undefined)?.message === 'string'
            ? (payload.error as Record<string, string>).message
            : JSON.stringify(payload);
        throw new Error(`${this.kind} API error (${res.status}): ${msg}`);
      }

      const choices = Array.isArray(payload.choices)
        ? (payload.choices as Array<Record<string, unknown>>)
        : [];
      const first = choices[0] ?? {};
      const message = (first.message as Record<string, unknown> | undefined) ?? {};
      const text = typeof message.content === 'string' ? message.content : '';

      const rawToolCalls = Array.isArray(message.tool_calls)
        ? (message.tool_calls as Array<Record<string, unknown>>)
        : [];

      const toolCalls: LLMToolCall[] = rawToolCalls.map((tc, idx) => {
        const fn = (tc.function as Record<string, unknown> | undefined) ?? {};
        let args: Record<string, unknown> = {};
        if (typeof fn.arguments === 'string') {
          try {
            args = JSON.parse(fn.arguments) as Record<string, unknown>;
          } catch {
            args = {};
          }
        } else if (fn.arguments && typeof fn.arguments === 'object') {
          args = fn.arguments as Record<string, unknown>;
        }
        return {
          id: String(tc.id ?? `call-${idx}`),
          name: String(fn.name ?? ''),
          arguments: args,
        };
      });

      const usageRaw = (payload.usage as Record<string, unknown> | undefined) ?? {};
      const inputTokens = Number(usageRaw.prompt_tokens ?? 0);
      const outputTokens = Number(usageRaw.completion_tokens ?? 0);
      const totalTokens = Number(usageRaw.total_tokens ?? inputTokens + outputTokens);

      return {
        text,
        toolCalls,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens,
          costUsd:
            this.kind === 'local'
              ? 0
              : estimateCostUsd(request.model, inputTokens, outputTokens),
        },
        model: request.model,
        provider: this.kind,
        stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
