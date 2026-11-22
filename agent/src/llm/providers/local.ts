import { OpenAICompatibleProvider } from './openai.ts';

export class LocalLLMProvider extends OpenAICompatibleProvider {
  constructor(baseUrl: string, apiKey = 'local') {
    const normalized = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/v1`;
    super(apiKey, normalized, 'local');
  }
}
