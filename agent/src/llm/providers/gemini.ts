import { estimateCostUsd } from '../config.ts';
import type {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMMessage,
  LLMProvider,
  LLMToolCall,
} from '../types.ts';

function toGeminiContents(messages: LLMMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      out.push({ role: 'user', parts: [{ text: msg.content }] });
    } else if (msg.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = [];
      if (msg.content) parts.push({ text: msg.content });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: tc.arguments,
            },
          });
        }
      }
      out.push({ role: 'model', parts });
    } else if (msg.role === 'tool') {
      let parsedResp: Record<string, unknown> = { output: msg.content };
      try {
        const obj = JSON.parse(msg.content) as unknown;
        if (obj && typeof obj === 'object') {
          parsedResp = obj as Record<string, unknown>;
        }
      } catch {
        // Keep wrapped string output
      }
      out.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: msg.toolName ?? 'tool',
              response: parsedResp,
            },
          },
        ],
      });
    }
  }
  return out;
}

export class GeminiProvider implements LLMProvider {
  readonly kind = 'gemini' as const;
  readonly isOfflineDemo = false;
  private apiKey: string;
  private baseUrl: string;

  constructor(
    apiKey: string,
    baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      const generationConfig: Record<string, unknown> = {};
      if (request.maxTokens) generationConfig.maxOutputTokens = request.maxTokens;
      if (typeof request.temperature === 'number') generationConfig.temperature = request.temperature;
      if (request.jsonMode) generationConfig.responseMimeType = 'application/json';

      const body: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: request.systemPrompt }] },
        contents: toGeminiContents(request.messages),
        generationConfig,
      };

      if (request.tools && request.tools.length > 0) {
        body.tools = [
          {
            functionDeclarations: request.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.inputSchema,
            })),
          },
        ];
      }

      const url = `${this.baseUrl}/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const payload = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const msg =
          typeof (payload.error as Record<string, unknown> | undefined)?.message === 'string'
            ? (payload.error as Record<string, string>).message
            : JSON.stringify(payload);
        throw new Error(`Gemini API error (${res.status}): ${msg}`);
      }

      const candidates = Array.isArray(payload.candidates)
        ? (payload.candidates as Array<Record<string, unknown>>)
        : [];
      const first = candidates[0] ?? {};
      const content = (first.content as Record<string, unknown> | undefined) ?? {};
      const parts = Array.isArray(content.parts)
        ? (content.parts as Array<Record<string, unknown>>)
        : [];

      const texts: string[] = [];
      const toolCalls: LLMToolCall[] = [];
      for (const p of parts) {
        if (typeof p.text === 'string') texts.push(p.text);
        if (p.functionCall && typeof p.functionCall === 'object') {
          const fc = p.functionCall as Record<string, unknown>;
          toolCalls.push({
            id: `gem-call-${toolCalls.length}`,
            name: String(fc.name ?? ''),
            arguments:
              fc.args && typeof fc.args === 'object'
                ? (fc.args as Record<string, unknown>)
                : {},
          });
        }
      }

      const usageMeta = (payload.usageMetadata as Record<string, unknown> | undefined) ?? {};
      const inputTokens = Number(usageMeta.promptTokenCount ?? 0);
      const outputTokens = Number(usageMeta.candidatesTokenCount ?? 0);
      const totalTokens = Number(usageMeta.totalTokenCount ?? inputTokens + outputTokens);

      return {
        text: texts.join('\n'),
        toolCalls,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens,
          costUsd: estimateCostUsd(request.model, inputTokens, outputTokens),
        },
        model: request.model,
        provider: 'gemini',
        stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
