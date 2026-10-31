import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'nexora_access_token';
const REFRESH_TOKEN_KEY = 'nexora_refresh_token';
const CUSTOM_API_URL_KEY = 'nexora_custom_api_url';

const DEFAULT_APK_CLOUD_API_URL =
  process.env.EXPO_PUBLIC_API_URL || 'https://4000-ibivk1a4786q7bfnwh01l.e2b.app/api/v1';

let runtimeCustomApiUrl: string | null = null;

export function isEmbeddedAndroidApk(): boolean {
  if (Platform.OS !== 'web') return true;
  if (typeof window !== 'undefined') {
    if ((window as any).NexoraAndroidBridge || window.location?.protocol === 'file:') {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the backend API URL safely:
 * - On Web live preview (http/https): uses relative '/api/v1' on same origin unless overridden.
 * - On Android APK (native or file:// WebView): uses configured cloud backend URL (zero private provider keys in APK!).
 */
export function getApiBaseUrl(): string {
  if (runtimeCustomApiUrl) {
    return runtimeCustomApiUrl.replace(/\/$/, '');
  }
  if (Platform.OS === 'web' && !isEmbeddedAndroidApk()) {
    return '/api/v1';
  }
  return DEFAULT_APK_CLOUD_API_URL.replace(/\/$/, '');
}

export async function setCustomApiBaseUrl(url: string | null): Promise<void> {
  const cleaned = url && url.trim() ? url.trim().replace(/\/$/, '') : null;
  const normalized =
    cleaned && !cleaned.endsWith('/api/v1') ? `${cleaned}/api/v1` : cleaned;
  runtimeCustomApiUrl = normalized;
  await setStoredItem(CUSTOM_API_URL_KEY, normalized);
}

export function getCustomApiBaseUrl(): string | null {
  return runtimeCustomApiUrl;
}

export const GITHUB_RELEASE_RAW_BASE =
  'https://github.com/Rusindu12/claude-mem/raw/arena/fbfc6b1f-claude-mem/nexora-ai/releases';

/**
 * Triggers a direct file download that works both inside sandboxed preview iframes (via Blob + <a download>)
 * and in standalone mobile/desktop browsers (with GitHub CDN fallback).
 */
export async function downloadReleaseArtifact(
  filename: 'NEXORA-AI-v1.0.0.apk' | 'NEXORA-AI-WebApp-v1.0.0.zip',
): Promise<void> {
  const localUrl = `/downloads/${filename}`;
  const githubMirrorUrl = `${GITHUB_RELEASE_RAW_BASE}/${filename}`;

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    try {
      const resp = await fetch(localUrl);
      if (resp.ok) {
        const blob = await resp.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          window.URL.revokeObjectURL(blobUrl);
          if (a.parentNode) a.parentNode.removeChild(a);
        }, 4000);
        return;
      }
    } catch {
      // Fallback to GitHub raw CDN link below
    }

    const fallbackAnchor = document.createElement('a');
    fallbackAnchor.href = githubMirrorUrl;
    fallbackAnchor.target = '_blank';
    fallbackAnchor.rel = 'noopener noreferrer';
    fallbackAnchor.download = filename;
    document.body.appendChild(fallbackAnchor);
    fallbackAnchor.click();
    setTimeout(() => {
      if (fallbackAnchor.parentNode) fallbackAnchor.parentNode.removeChild(fallbackAnchor);
    }, 1000);
  }
}

async function setStoredItem(key: string, value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (value === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, value);
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

async function getStoredItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

class NexoraApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  async hydrateTokens(): Promise<boolean> {
    const savedCustomUrl = await getStoredItem(CUSTOM_API_URL_KEY);
    if (savedCustomUrl) {
      runtimeCustomApiUrl = savedCustomUrl;
    }
    this.accessToken = await getStoredItem(ACCESS_TOKEN_KEY);
    this.refreshToken = await getStoredItem(REFRESH_TOKEN_KEY);
    return Boolean(this.accessToken);
  }

  async saveTokens(access: string, refresh: string): Promise<void> {
    this.accessToken = access;
    this.refreshToken = refresh;
    await setStoredItem(ACCESS_TOKEN_KEY, access);
    await setStoredItem(REFRESH_TOKEN_KEY, refresh);
  }

  async clearTokens(): Promise<void> {
    this.accessToken = null;
    this.refreshToken = null;
    await setStoredItem(ACCESS_TOKEN_KEY, null);
    await setStoredItem(REFRESH_TOKEN_KEY, null);
  }

  async request<T = any>(
    path: string,
    options: {
      method?: string;
      body?: any;
      headers?: Record<string, string>;
      skipAuthRefresh?: boolean;
    } = {},
  ): Promise<T> {
    const url = `${getApiBaseUrl()}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (res.status === 401 && this.refreshToken && !options.skipAuthRefresh) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        return this.request<T>(path, { ...options, skipAuthRefresh: true });
      }
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = Array.isArray(data?.message)
        ? data.message.join(', ')
        : data?.message || `HTTP ${res.status}`;
      const err: any = new Error(msg);
      err.status = res.status;
      err.code = data?.code;
      err.details = data?.details;
      throw err;
    }
    return data as T;
  }

  private async tryRefresh(): Promise<boolean> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
      if (!res.ok) {
        await this.clearTokens();
        return false;
      }
      const data = await res.json();
      await this.saveTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Streams AI chat response tokens via SSE (`/chat/conversations/:id/stream`),
   * falling back cleanly to standard JSON fetch on environments without ReadableStream.
   */
  async streamConversationMessage(
    conversationId: string,
    payload: {
      content: string;
      modelId?: string;
      attachmentFileIds?: string[];
      allowFallback?: boolean;
    },
    onDelta: (delta: string) => void,
  ): Promise<any> {
    const url = `${getApiBaseUrl()}/chat/conversations/${conversationId}/stream`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson?.message || `Chat request failed (${res.status})`);
    }

    if (!res.body || typeof res.body.getReader !== 'function') {
      const text = await res.text();
      return this.parseCompletedEventFromSseText(text, onDelta);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completedPayload: any = null;
    let errorPayload: any = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        const lines = block.split('\n');
        let ev = 'message';
        let dataStr = '';
        for (const l of lines) {
          if (l.startsWith('event:')) ev = l.slice(6).trim();
          else if (l.startsWith('data:')) dataStr += l.slice(5).trim();
        }
        if (!dataStr) continue;
        const parsed = JSON.parse(dataStr);
        if (ev === 'delta' && parsed.delta) onDelta(parsed.delta);
        else if (ev === 'completed') completedPayload = parsed;
        else if (ev === 'error') errorPayload = parsed;
      }
    }

    if (errorPayload) {
      throw new Error(errorPayload.message || 'AI stream failed');
    }
    return completedPayload;
  }

  private parseCompletedEventFromSseText(raw: string, onDelta: (d: string) => void): any {
    const blocks = raw.split('\n\n');
    let completed: any = null;
    for (const block of blocks) {
      const lines = block.split('\n');
      let ev = '';
      let dataStr = '';
      for (const l of lines) {
        if (l.startsWith('event:')) ev = l.slice(6).trim();
        else if (l.startsWith('data:')) dataStr += l.slice(5).trim();
      }
      if (!dataStr) continue;
      const parsed = JSON.parse(dataStr);
      if (ev === 'delta' && parsed.delta) onDelta(parsed.delta);
      if (ev === 'completed') completed = parsed;
      if (ev === 'error') throw new Error(parsed.message || 'AI error');
    }
    return completed;
  }
}

export const apiClient = new NexoraApiClient();
