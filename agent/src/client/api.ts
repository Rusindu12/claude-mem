import type {
  ActionLogEntry,
  BrainClassification,
  BrainStatusInfo,
  ChatMessageRecord,
  EvalRunRecord,
  MemoryItem,
  ProjectNote,
  ProjectRecord,
  ProviderStatusInfo,
  RunRecord,
} from '../shared/types.ts';
import {
  getLocalHealth,
  localClassifyPrompt,
  localCreateProject,
  localGetProjectDetail,
  localListProjects,
  localReadFile,
  localRetrainBrain,
  localStartRun,
} from './local-runtime.ts';

const SERVER_URL_KEY = 'axiom_remote_server_url';
let standaloneLocalMode = false;

export function getServerBase(): string {
  try {
    return (localStorage.getItem(SERVER_URL_KEY) ?? '').replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function setServerBase(url: string): void {
  try {
    const clean = url.trim().replace(/\/+$/, '');
    if (clean) {
      localStorage.setItem(SERVER_URL_KEY, clean);
    } else {
      localStorage.removeItem(SERVER_URL_KEY);
    }
    standaloneLocalMode = false;
  } catch {
    // ignore
  }
}

export function isStandaloneLocalMode(): boolean {
  return standaloneLocalMode;
}

export function apiUrl(path: string): string {
  const base = getServerBase();
  return base ? `${base}${path}` : path;
}

export interface DownloadsStatus {
  apk: {
    ready: boolean;
    filename: string;
    sizeBytes?: number;
    sha256?: string;
    updatedAt?: string;
    url?: string;
  };
  webApp: {
    ready: boolean;
    filename: string;
    url: string;
    pwaInstallable: boolean;
  };
}

export async function fetchHealth(): Promise<{
  ok: boolean;
  status: ProviderStatusInfo;
  brain: BrainStatusInfo;
  toolsCount: number;
}> {
  try {
    const res = await fetch(apiUrl('/api/health'));
    const ctype = res.headers.get('content-type') || '';
    if (!res.ok || !ctype.includes('application/json')) {
      throw new Error(`Health unavailable (${res.status})`);
    }
    standaloneLocalMode = false;
    return (await res.json()) as {
      ok: boolean;
      status: ProviderStatusInfo;
      brain: BrainStatusInfo;
      toolsCount: number;
    };
  } catch {
    standaloneLocalMode = true;
    return getLocalHealth();
  }
}

export async function fetchDownloadsStatus(): Promise<DownloadsStatus | null> {
  if (standaloneLocalMode) return null;
  try {
    const res = await fetch(apiUrl('/api/downloads/status'));
    if (!res.ok) return null;
    return (await res.json()) as DownloadsStatus;
  } catch {
    return null;
  }
}

export async function retrainBrain(): Promise<BrainStatusInfo> {
  if (standaloneLocalMode) return localRetrainBrain();
  const res = await fetch(apiUrl('/api/brain/train'), { method: 'POST' });
  if (!res.ok) throw new Error('Failed to retrain neural brain');
  const data = (await res.json()) as { brain: BrainStatusInfo };
  return data.brain;
}

export async function classifyPromptApi(prompt: string): Promise<BrainClassification> {
  if (standaloneLocalMode) return localClassifyPrompt(prompt);
  const res = await fetch(apiUrl('/api/brain/classify'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error('Classification failed');
  const data = (await res.json()) as { classification: BrainClassification };
  return data.classification;
}

export async function fetchProjects(): Promise<ProjectRecord[]> {
  if (standaloneLocalMode) return localListProjects();
  const res = await fetch(apiUrl('/api/projects'));
  if (!res.ok) throw new Error('Failed to load projects');
  const data = (await res.json()) as { projects: ProjectRecord[] };
  return data.projects;
}

export async function createProject(name: string): Promise<ProjectRecord> {
  if (standaloneLocalMode) return localCreateProject(name);
  const res = await fetch(apiUrl('/api/projects'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Failed to create project');
  const data = (await res.json()) as { project: ProjectRecord };
  return data.project;
}

export async function fetchProjectDetail(projectId: string): Promise<{
  project: ProjectRecord;
  runs: RunRecord[];
  messages: ChatMessageRecord[];
  files: Array<{ path: string; size: number }>;
  notes: ProjectNote[];
  logs: ActionLogEntry[];
}> {
  if (standaloneLocalMode) return localGetProjectDetail(projectId);
  const res = await fetch(apiUrl(`/api/projects/${encodeURIComponent(projectId)}`));
  if (!res.ok) throw new Error('Failed to fetch project details');
  return res.json();
}

export async function fetchProjectFile(projectId: string, filePath: string): Promise<string> {
  if (standaloneLocalMode) return localReadFile(projectId, filePath);
  const res = await fetch(
    apiUrl(`/api/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(filePath)}`),
  );
  if (!res.ok) throw new Error('Failed to read file');
  const data = (await res.json()) as { content: string };
  return data.content;
}

export async function startRun(params: {
  projectId?: string;
  prompt: string;
}): Promise<{ project: ProjectRecord; run: RunRecord }> {
  if (standaloneLocalMode) return localStartRun(params);
  const res = await fetch(apiUrl('/api/runs'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to start run');
  return res.json();
}

export async function confirmRunAction(runId: string, approved: boolean): Promise<void> {
  if (standaloneLocalMode) return;
  const res = await fetch(apiUrl(`/api/runs/${encodeURIComponent(runId)}/confirm`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ approved }),
  });
  if (!res.ok) throw new Error('Failed to submit confirmation');
}

export async function fetchMemories(): Promise<MemoryItem[]> {
  if (standaloneLocalMode) return [];
  const res = await fetch(apiUrl('/api/memory'));
  if (!res.ok) throw new Error('Failed to fetch memory');
  const data = (await res.json()) as { memories: MemoryItem[] };
  return data.memories;
}

export async function addMemoryEntry(input: {
  category: MemoryItem['category'];
  title: string;
  content: string;
}): Promise<MemoryItem> {
  if (standaloneLocalMode) {
    return {
      id: `mem-${Date.now()}`,
      category: input.category,
      title: input.title,
      content: input.content,
      tags: ['on-device'],
      confidence: 0.9,
      hits: 0,
      createdAt: new Date().toISOString(),
    };
  }
  const res = await fetch(apiUrl('/api/memory'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Failed to store memory');
  const data = (await res.json()) as { memory: MemoryItem };
  return data.memory;
}

export async function fetchEvalRuns(): Promise<EvalRunRecord[]> {
  if (standaloneLocalMode) return [];
  const res = await fetch(apiUrl('/api/evals'));
  if (!res.ok) throw new Error('Failed to load evals');
  const data = (await res.json()) as { evalRuns: EvalRunRecord[] };
  return data.evalRuns;
}

export async function triggerEvalRun(): Promise<EvalRunRecord> {
  if (standaloneLocalMode) throw new Error('Eval suite requires Node server runtime');
  const res = await fetch(apiUrl('/api/evals/run'), { method: 'POST' });
  if (!res.ok) throw new Error('Failed to execute eval suite');
  const data = (await res.json()) as { evalRun: EvalRunRecord };
  return data.evalRun;
}
