import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CryptoService } from '../../config/crypto.service';

export interface ChatTurnMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  imageMimeType?: string;
  imageBase64?: string;
}

export interface ProviderChatRequest {
  providerId: string;
  providerCode?: string;
  enforceFreeOnly?: boolean;
  adapterType: 'OPENAI' | 'GEMINI' | 'ANTHROPIC' | 'OPENAI_COMPATIBLE';
  baseUrl: string;
  apiKey: string;
  modelKey: string;
  messages: ChatTurnMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs: number;
  maxRetries: number;
  onTokenDelta?: (delta: string) => void;
}

export interface ProviderChatResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  retryCount: number;
}

export interface ProviderMediaResponse {
  outputUrls: string[];
  providerCostUnits: number;
  externalJobId?: string;
}

@Injectable()
export class AiProvidersService {
  private readonly logger = new Logger(AiProvidersService.name);

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
  ) {}

  decryptProviderKey(encrypted: string | null): string | null {
    if (!encrypted) return null;
    try {
      return this.crypto.decrypt(encrypted);
    } catch {
      return null;
    }
  }

  /**
   * Executes a real chat completion (streaming or non-streaming) against OpenAI, Gemini, Anthropic, or OpenAI-compatible APIs.
   * Includes timeout control (AbortController) and automatic transient-error retries.
   */
  async executeChat(req: ProviderChatRequest): Promise<ProviderChatResponse> {
    const startedAt = Date.now();
    let attempt = 0;
    let lastError: any = null;

    while (attempt <= req.maxRetries) {
      try {
        let result: { content: string; inputTokens: number; outputTokens: number };
        switch (req.adapterType) {
          case 'OPENAI':
          case 'OPENAI_COMPATIBLE':
            result = await this.callOpenAiCompatible(req);
            break;
          case 'GEMINI':
            result = await this.callGemini(req);
            break;
          case 'ANTHROPIC':
            result = await this.callAnthropic(req);
            break;
          default:
            throw new Error(`Unsupported adapter type: ${req.adapterType}`);
        }

        await this.markProviderSuccess(req.providerId);
        return {
          ...result,
          latencyMs: Date.now() - startedAt,
          retryCount: attempt,
        };
      } catch (err: any) {
        lastError = err;
        const isTransient =
          err?.name === 'AbortError' ||
          err?.retryable === true ||
          [408, 429, 500, 502, 503, 504].includes(err?.httpStatus);

        if (!isTransient || attempt >= req.maxRetries) {
          await this.markProviderFailure(req.providerId, err?.message || 'Provider error');
          break;
        }
        attempt += 1;
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }

    const status =
      lastError?.name === 'AbortError'
        ? HttpStatus.GATEWAY_TIMEOUT
        : lastError?.httpStatus || HttpStatus.BAD_GATEWAY;
    const ex = new HttpException(
      {
        code: lastError?.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_REQUEST_FAILED',
        message: lastError?.message || 'Upstream AI provider failed',
      },
      status,
    );
    (ex as any).retryCount = attempt;
    (ex as any).upstreamStatus = lastError?.httpStatus || status;
    throw ex;
  }

  private async callOpenAiCompatible(
    req: ProviderChatRequest,
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const url = `${req.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const formattedMessages = req.messages.map((m) => {
      if (m.imageBase64 && m.role === 'user') {
        return {
          role: 'user',
          content: [
            { type: 'text', text: m.content },
            {
              type: 'image_url',
              image_url: {
                url: `data:${m.imageMimeType || 'image/png'};base64,${m.imageBase64}`,
              },
            },
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

    const stream = Boolean(req.onTokenDelta);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);

    try {
      const isOpenRouter =
        req.providerCode === 'openrouter_oss' ||
        req.baseUrl.includes('openrouter.ai') ||
        Boolean(req.apiKey && req.apiKey.startsWith('sk-or-'));

      if (isOpenRouter && req.enforceFreeOnly) {
        const isFreeSlug =
          req.modelKey === 'openrouter/free' || req.modelKey.endsWith(':free');
        if (!isFreeSlug) {
          const blockedErr: any = new Error(
            `Blocked paid OpenRouter model "${req.modelKey}" — OpenRouter Free-Only protection permits ONLY :free models`,
          );
          blockedErr.httpStatus = 403;
          blockedErr.retryable = false;
          throw blockedErr;
        }
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (req.apiKey) {
        headers.Authorization = `Bearer ${req.apiKey}`;
      }
      if (isOpenRouter) {
        headers['HTTP-Referer'] = 'https://nexora.ai';
        headers['X-Title'] = 'NEXORA AI';
      }

      const payloadBody: Record<string, any> = {
        model: req.modelKey,
        messages: formattedMessages,
        max_tokens: req.maxOutputTokens || 2048,
        temperature: req.temperature ?? 0.7,
        stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      };

      // OpenRouter protocol-level $0.00 ceiling so OpenRouter NEVER routes to a paid upstream
      if (isOpenRouter && req.enforceFreeOnly) {
        payloadBody.provider = {
          max_price: { prompt: 0, completion: 0 },
        };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payloadBody),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const e: any = new Error(`OpenAI provider HTTP ${res.status}: ${errText.slice(0, 240)}`);
        e.httpStatus = res.status;
        throw e;
      }

      if (!stream) {
        const json: any = await res.json();
        const content = json.choices?.[0]?.message?.content || '';
        const inputTokens =
          json.usage?.prompt_tokens ?? this.estimateTokenCount(req.messages.map((m) => m.content).join(' '));
        const outputTokens =
          json.usage?.completion_tokens ?? this.estimateTokenCount(content);
        return { content, inputTokens, outputTokens };
      }

      // Parse SSE stream
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let promptTokens = 0;
      let completionTokens = 0;

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              req.onTokenDelta?.(delta);
            }
            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens || promptTokens;
              completionTokens = parsed.usage.completion_tokens || completionTokens;
            }
          } catch {
            // Ignore partial keepalive comment lines
          }
        }
      }

      return {
        content: fullText,
        inputTokens: promptTokens || this.estimateTokenCount(req.messages.map((m) => m.content).join(' ')),
        outputTokens: completionTokens || this.estimateTokenCount(fullText),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async callGemini(
    req: ProviderChatRequest,
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const systemMsg = req.messages.find((m) => m.role === 'system');
    const turns = req.messages.filter((m) => m.role !== 'system');
    const contents = turns.map((m) => {
      const parts: any[] = [{ text: m.content }];
      if (m.imageBase64) {
        parts.push({
          inlineData: {
            mimeType: m.imageMimeType || 'image/png',
            data: m.imageBase64,
          },
        });
      }
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts,
      };
    });

    const endpointAction = req.onTokenDelta ? 'streamGenerateContent?alt=sse&' : 'generateContent?';
    const url = `${req.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(req.modelKey)}:${endpointAction}key=${encodeURIComponent(req.apiKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
          contents,
          generationConfig: {
            maxOutputTokens: req.maxOutputTokens || 2048,
            temperature: req.temperature ?? 0.7,
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const e: any = new Error(`Gemini provider HTTP ${res.status}: ${errText.slice(0, 240)}`);
        e.httpStatus = res.status;
        throw e;
      }

      if (!req.onTokenDelta) {
        const json: any = await res.json();
        const content =
          json.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
        const inputTokens =
          json.usageMetadata?.promptTokenCount ??
          this.estimateTokenCount(req.messages.map((m) => m.content).join(' '));
        const outputTokens =
          json.usageMetadata?.candidatesTokenCount ?? this.estimateTokenCount(content);
        return { content, inputTokens, outputTokens };
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let inTok = 0;
      let outTok = 0;

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            const delta =
              parsed.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
            if (delta) {
              fullText += delta;
              req.onTokenDelta(delta);
            }
            if (parsed.usageMetadata) {
              inTok = parsed.usageMetadata.promptTokenCount || inTok;
              outTok = parsed.usageMetadata.candidatesTokenCount || outTok;
            }
          } catch {
            // Ignore malformed keepalive line
          }
        }
      }

      return {
        content: fullText,
        inputTokens: inTok || this.estimateTokenCount(req.messages.map((m) => m.content).join(' ')),
        outputTokens: outTok || this.estimateTokenCount(fullText),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async callAnthropic(
    req: ProviderChatRequest,
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const url = `${req.baseUrl.replace(/\/$/, '')}/messages`;
    const systemMsg = req.messages.find((m) => m.role === 'system');
    const turns = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.imageBase64 && m.role === 'user') {
          return {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: m.imageMimeType || 'image/png',
                  data: m.imageBase64,
                },
              },
              { type: 'text', text: m.content },
            ],
          };
        }
        return { role: m.role, content: m.content };
      });

    const stream = Boolean(req.onTokenDelta);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': req.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: req.modelKey,
          max_tokens: req.maxOutputTokens || 2048,
          ...(systemMsg ? { system: systemMsg.content } : {}),
          messages: turns,
          stream,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const e: any = new Error(`Anthropic provider HTTP ${res.status}: ${errText.slice(0, 240)}`);
        e.httpStatus = res.status;
        throw e;
      }

      if (!stream) {
        const json: any = await res.json();
        const content = (json.content || [])
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('');
        return {
          content,
          inputTokens:
            json.usage?.input_tokens ??
            this.estimateTokenCount(req.messages.map((m) => m.content).join(' ')),
          outputTokens: json.usage?.output_tokens ?? this.estimateTokenCount(content),
        };
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let inTok = 0;
      let outTok = 0;

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          try {
            const parsed = JSON.parse(payload);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              fullText += parsed.delta.text;
              req.onTokenDelta?.(parsed.delta.text);
            }
            if (parsed.message?.usage?.input_tokens) {
              inTok = parsed.message.usage.input_tokens;
            }
            if (parsed.usage?.output_tokens) {
              outTok = parsed.usage.output_tokens;
            }
          } catch {
            // Ignore non-JSON SSE lines
          }
        }
      }

      return {
        content: fullText,
        inputTokens: inTok || this.estimateTokenCount(req.messages.map((m) => m.content).join(' ')),
        outputTokens: outTok || this.estimateTokenCount(fullText),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Executes real Image Generation (OpenAI /v1/images/generations or Gemini Imagen endpoint).
   */
  async executeImageGeneration(params: {
    providerId: string;
    adapterType: string;
    baseUrl: string;
    apiKey: string;
    modelKey: string;
    prompt: string;
    size?: string;
    count?: number;
    timeoutMs: number;
  }): Promise<ProviderMediaResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
      const n = Math.min(4, Math.max(1, params.count || 1));

      // Pollinations Free Keyless Flux Image Generation ($0.00 provider cost)
      if (params.baseUrl.includes('pollinations.ai')) {
        const [wStr, hStr] = (params.size || '1024x1024').split('x');
        const width = Number(wStr) || 1024;
        const height = Number(hStr) || 1024;
        const urls: string[] = [];
        for (let i = 0; i < n; i++) {
          const seed = Math.floor(Math.random() * 1000000) + i;
          const imgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(params.prompt)}?width=${width}&height=${height}&model=${encodeURIComponent(params.modelKey || 'flux')}&nologo=true&seed=${seed}`;
          const checkRes = await fetch(imgUrl, { method: 'GET', signal: controller.signal });
          if (!checkRes.ok) {
            throw new Error(`Pollinations Free Image HTTP ${checkRes.status}`);
          }
          urls.push(imgUrl);
        }
        await this.markProviderSuccess(params.providerId);
        return { outputUrls: urls, providerCostUnits: urls.length || 1 };
      }

      if (params.adapterType === 'GEMINI') {
        const url = `${params.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(params.modelKey)}:predict?key=${encodeURIComponent(params.apiKey)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: params.prompt }],
            parameters: { sampleCount: n },
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Gemini Image HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }
        const json: any = await res.json();
        const urls = (json.predictions || []).map(
          (p: any) => p.url || `data:image/png;base64,${p.bytesBase64Encoded}`,
        );
        await this.markProviderSuccess(params.providerId);
        return { outputUrls: urls, providerCostUnits: urls.length || 1 };
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (params.apiKey) {
        headers.Authorization = `Bearer ${params.apiKey}`;
      }

      const url = `${params.baseUrl.replace(/\/$/, '')}/images/generations`;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: params.modelKey,
          prompt: params.prompt,
          n,
          size: params.size || '1024x1024',
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Image provider HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const json: any = await res.json();
      const urls = (json.data || []).map(
        (d: any) => d.url || (d.b64_json ? `data:image/png;base64,${d.b64_json}` : ''),
      );
      await this.markProviderSuccess(params.providerId);
      return { outputUrls: urls.filter(Boolean), providerCostUnits: urls.length || 1 };
    } catch (err: any) {
      await this.markProviderFailure(params.providerId, err?.message || 'Image generation failed');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Executes real Video Generation via connected provider endpoint (/videos/generations or Veo predictLongRunning).
   */
  async executeVideoGeneration(params: {
    providerId: string;
    adapterType: string;
    baseUrl: string;
    apiKey: string;
    modelKey: string;
    prompt: string;
    durationSeconds: number;
    sourceImageBase64?: string;
    timeoutMs: number;
  }): Promise<ProviderMediaResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
      const url =
        params.adapterType === 'GEMINI'
          ? `${params.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(params.modelKey)}:generateVideo?key=${encodeURIComponent(params.apiKey)}`
          : `${params.baseUrl.replace(/\/$/, '')}/videos/generations`;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (params.adapterType !== 'GEMINI') {
        headers.Authorization = `Bearer ${params.apiKey}`;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: params.modelKey,
          prompt: params.prompt,
          duration_seconds: params.durationSeconds,
          ...(params.sourceImageBase64 ? { image_base64: params.sourceImageBase64 } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Video provider HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const json: any = await res.json();
      const urls: string[] = json.output_urls || (json.data || []).map((d: any) => d.url).filter(Boolean);
      await this.markProviderSuccess(params.providerId);
      return {
        outputUrls: urls,
        providerCostUnits: params.durationSeconds,
        externalJobId: json.id || json.name,
      };
    } catch (err: any) {
      await this.markProviderFailure(params.providerId, err?.message || 'Video generation failed');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  estimateTokenCount(text: string): number {
    if (!text) return 0;
    // Sinhala Unicode scripts average slightly higher UTF-8 density per token; ~3.6 chars/token heuristic
    return Math.max(1, Math.ceil(text.length / 3.6));
  }

  private async markProviderSuccess(providerId: string): Promise<void> {
    await this.db.query(
      `UPDATE ai_providers
       SET health_status = 'HEALTHY',
           consecutive_failures = 0,
           last_error = NULL,
           last_health_check_at = NOW()
       WHERE id = $1 AND health_status <> 'BUDGET_EXCEEDED'`,
      [providerId],
    );
  }

  private async markProviderFailure(providerId: string, errorMessage: string): Promise<void> {
    await this.db.query(
      `UPDATE ai_providers
       SET consecutive_failures = consecutive_failures + 1,
           health_status = CASE WHEN consecutive_failures + 1 >= 3 THEN 'DEGRADED' ELSE health_status END,
           last_error = $1,
           last_health_check_at = NOW()
       WHERE id = $2 AND health_status <> 'BUDGET_EXCEEDED'`,
      [errorMessage.slice(0, 500), providerId],
    );
  }
}
