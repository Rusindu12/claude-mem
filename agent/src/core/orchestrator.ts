import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createFileBrainStorage } from '../ai/brain-storage.ts';
import { AxiomNeuralCore } from '../ai/neural-core.ts';
import { parsePromptWithBrain } from '../ai/semantic-parser.ts';
import type { AxiomConfig } from '../llm/config.ts';
import { ModelRouter } from '../llm/router.ts';
import type { LLMProvider } from '../llm/types.ts';
import type { AxiomStore } from '../memory/store.ts';
import type {
  ActionLogEntry,
  BrainClassification,
  BrainStatusInfo,
  ProjectRecord,
  RunRecord,
} from '../shared/types.ts';
import { registerBuiltinTools } from '../tools/builtin.ts';
import { PreviewManager } from '../tools/preview.ts';
import { ToolRegistry } from '../tools/registry.ts';
import { AgentLoopRunner } from './loop.ts';
import { detectLanguage } from './prompts.ts';
import { resolveWorkspacePath } from './security.ts';

export type SSEListener = (payload: {
  type: 'log' | 'run_update';
  run: RunRecord;
  log?: ActionLogEntry;
}) => void;

function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return s || 'project';
}

export class AxiomOrchestrator {
  readonly config: AxiomConfig;
  readonly store: AxiomStore;
  readonly brain: AxiomNeuralCore;
  readonly router: ModelRouter;
  readonly registry: ToolRegistry;
  readonly previewManager: PreviewManager;
  private listeners = new Map<string, Set<SSEListener>>();

  constructor(params: {
    config: AxiomConfig;
    store: AxiomStore;
    providerOverride?: LLMProvider;
    brain?: AxiomNeuralCore;
  }) {
    this.config = params.config;
    this.store = params.store;
    this.brain =
      params.brain ??
      new AxiomNeuralCore(createFileBrainStorage(path.join(params.config.dataDir, 'axiom-brain.json')));
    this.router = new ModelRouter(params.config, params.providerOverride, this.brain);
    this.previewManager = new PreviewManager(params.store);
    this.registry = new ToolRegistry();
    registerBuiltinTools(this.registry);
    this.registry.loadPluginsConfig(params.config.pluginsConfigPath);
  }

  getBrainStatus(): BrainStatusInfo {
    return this.brain.getStatus();
  }

  retrainBrain(): BrainStatusInfo {
    return this.brain.initAndTrain();
  }

  classifyPrompt(prompt: string): BrainClassification {
    const parsed = parsePromptWithBrain(prompt, this.brain);
    return {
      intent: parsed.intent,
      confidence: parsed.confidence,
      topIntents: parsed.rankedIntents,
      language: parsed.language,
      brand: parsed.brand,
      domain: parsed.domain,
    };
  }

  subscribeRun(runId: string, listener: SSEListener): () => void {
    let set = this.listeners.get(runId);
    if (!set) {
      set = new Set();
      this.listeners.set(runId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        this.listeners.delete(runId);
      }
    };
  }

  private broadcast(payload: {
    type: 'log' | 'run_update';
    run: RunRecord;
    log?: ActionLogEntry;
  }): void {
    const set = this.listeners.get(payload.run.id);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch {
        // Ignore dropped SSE clients
      }
    }
  }

  createProject(name: string): ProjectRecord {
    const id = `proj-${randomUUID().slice(0, 8)}`;
    const slug = `${slugify(name)}-${id.slice(-4)}`;
    const workspacePath = path.join(this.config.workspacesDir, slug);
    return this.store.createProject({ id, name, slug, workspacePath });
  }

  async ensureProjectPreview(projectId: string): Promise<number | undefined> {
    const existingPort = this.previewManager.getPort(projectId);
    if (existingPort) return existingPort;

    const project = this.store.getProject(projectId);
    if (!project) return undefined;
    if (!fs.existsSync(path.join(project.workspacePath, 'index.html'))) {
      return undefined;
    }
    const started = await this.previewManager.startStaticPreview(projectId, project.workspacePath);
    return started.port;
  }

  startRunAsync(params: { projectId?: string; prompt: string }): {
    project: ProjectRecord;
    run: RunRecord;
    completion: Promise<RunRecord>;
  } {
    let project = params.projectId ? this.store.getProject(params.projectId) : null;
    if (!project) {
      const title = params.prompt.slice(0, 42).trim() || 'New Project';
      project = this.createProject(title);
    }

    const lang = detectLanguage(params.prompt);
    const run = this.store.createRun({
      projectId: project.id,
      prompt: params.prompt,
      language: lang,
      provider: this.router.provider.kind,
      isOfflineDemo: this.router.provider.isOfflineDemo,
      reasoningModel: this.config.reasoningModel,
      fastModel: this.config.fastModel,
    });

    this.store.addMessage({
      runId: run.id,
      projectId: project.id,
      role: 'user',
      content: params.prompt,
    });

    const runner = new AgentLoopRunner({
      config: this.config,
      store: this.store,
      router: this.router,
      registry: this.registry,
      previewManager: this.previewManager,
      onEvent: (ev) => this.broadcast(ev),
    });

    const completion = runner.executeRun(run.id);
    return { project, run, completion };
  }

  async confirmRun(runId: string, approved: boolean): Promise<RunRecord> {
    const runner = new AgentLoopRunner({
      config: this.config,
      store: this.store,
      router: this.router,
      registry: this.registry,
      previewManager: this.previewManager,
      onEvent: (ev) => this.broadcast(ev),
    });
    return runner.executeRun(runId, { resumeConfirmationApproved: approved });
  }

  async resumeRun(runId: string): Promise<RunRecord> {
    const runner = new AgentLoopRunner({
      config: this.config,
      store: this.store,
      router: this.router,
      registry: this.registry,
      previewManager: this.previewManager,
      onEvent: (ev) => this.broadcast(ev),
    });
    return runner.executeRun(runId);
  }

  listProjectFiles(projectId: string): Array<{ path: string; size: number }> {
    const project = this.store.getProject(projectId);
    if (!project || !fs.existsSync(project.workspacePath)) return [];

    const out: Array<{ path: string; size: number }> = [];
    function walk(dir: string, root: string) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist') continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full, root);
        else out.push({ path: path.relative(root, full), size: fs.statSync(full).size });
      }
    }
    walk(project.workspacePath, project.workspacePath);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  readProjectFile(projectId: string, relPath: string): string {
    const project = this.store.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const abs = resolveWorkspacePath(project.workspacePath, relPath);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      throw new Error('File not found');
    }
    return fs.readFileSync(abs, 'utf8');
  }
}
