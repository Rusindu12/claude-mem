import { estimateCostUsd } from '../config.ts';
import type {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMMessage,
  LLMProvider,
  LLMToolCall,
} from '../types.ts';

function toAnthropicMessages(messages: LLMMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      out.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      const blocks: Array<Record<string, unknown>> = [];
      if (msg.content) {
        blocks.push({ type: 'text', text: msg.content });
      }
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
      }
      out.push({ role: 'assistant', content: blocks.length > 0 ? blocks : msg.content });
    } else if (msg.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: msg.toolCallId ?? 'tool-0',
        content: msg.content,
      };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        (last.content as Array<Record<string, unknown>>).push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    }
  }
  return out;
}

export class AnthropicProvider implements LLMProvider {
  readonly kind = 'anthropic' as const;
  readonly isOfflineDemo = false;
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.anthropic.com/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        system: request.systemPrompt,
        messages: toAnthropicMessages(request.messages),
      };

      if (typeof request.temperature === 'number') {
        body.temperature = request.temperature;
      }

      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        }));
      }

      const res = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const payload = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const msg =
          typeof (payload.error as Record<string, unknown> | undefined)?.message === 'string'
            ? (payload.error as Record<string, string>).message
            : JSON.stringify(payload);
        throw new Error(`Anthropic API error (${res.status}): ${msg}`);
      }

      const contentBlocks = Array.isArray(payload.content)
        ? (payload.content as Array<Record<string, unknown>>)
        : [];
      const textParts: string[] = [];
      const toolCalls: LLMToolCall[] = [];

      for (const block of contentBlocks) {
        if (block.type === 'text' && typeof block.text === 'string') {
          textParts.push(block.text);
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: String(block.id ?? `call-${toolCalls.length}`),
            name: String(block.name),
            arguments:
              block.input && typeof block.input === 'object'
                ? (block.input as Record<string, unknown>)
                : {},
          });
        }
      }

      const usageRaw = (payload.usage as Record<string, unknown> | undefined) ?? {};
      const inputTokens = Number(usageRaw.input_tokens ?? 0);
      const outputTokens = Number(usageRaw.output_tokens ?? 0);
      const totalTokens = inputTokens + outputTokens;

      return {
        text: textParts.join('\n'),
        toolCalls,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens,
          costUsd: estimateCostUsd(request.model, inputTokens, outputTokens),
        },
        model: request.model,
        provider: 'anthropic',
        stopReason:
          payload.stop_reason === 'tool_use' || toolCalls.length > 0
            ? 'tool_use'
            : payload.stop_reason === 'max_tokens'
              ? 'max_tokens'
              : 'end_turn',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
