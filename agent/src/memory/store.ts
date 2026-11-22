import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  ActionLogEntry,
  ChatMessageRecord,
  EvalRunRecord,
  LanguageCode,
  LoopPhase,
  MemoryItem,
  ProjectNote,
  ProjectRecord,
  ProviderKind,
  RunCheckpoint,
  RunRecord,
  RunStatus,
} from '../shared/types.ts';

function nowIso(): string {
  return new Date().toISOString();
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class AxiomStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        preview_port INTEGER,
        preview_status TEXT NOT NULL DEFAULT 'stopped',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        prompt TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'en',
        status TEXT NOT NULL,
        provider TEXT NOT NULL,
        is_offline_demo INTEGER NOT NULL DEFAULT 0,
        reasoning_model TEXT NOT NULL,
        fast_model TEXT NOT NULL,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        total_cost_usd REAL NOT NULL DEFAULT 0,
        current_phase TEXT NOT NULL DEFAULT 'understand',
        iteration INTEGER NOT NULL DEFAULT 0,
        final_summary TEXT,
        checkpoint_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS action_logs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        phase TEXT NOT NULL,
        event_type TEXT NOT NULL,
        tool_name TEXT,
        summary TEXT NOT NULL,
        input_json TEXT,
        output_json TEXT,
        status TEXT NOT NULL DEFAULT 'ok',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        model_used TEXT,
        model_tier TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_notes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, key)
      );

      CREATE TABLE IF NOT EXISTS long_term_memory (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        source_run_id TEXT,
        confidence REAL NOT NULL DEFAULT 0.8,
        hits INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS eval_runs (
        id TEXT PRIMARY KEY,
        suite_version TEXT NOT NULL,
        provider TEXT NOT NULL,
        total_tasks INTEGER NOT NULL,
        passed INTEGER NOT NULL,
        failed INTEGER NOT NULL,
        total_duration_ms INTEGER NOT NULL,
        results_json TEXT NOT NULL,
        regressions_json TEXT NOT NULL DEFAULT '[]',
        improvements_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_logs_run ON action_logs(run_id, seq ASC);
      CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id, created_at ASC);
    `);
  }

  close(): void {
    this.db.close();
  }

  // ---- Projects ----

  createProject(input: { id?: string; name: string; slug: string; workspacePath: string }): ProjectRecord {
    const id = input.id ?? `proj-${randomUUID().slice(0, 8)}`;
    const ts = nowIso();
    fs.mkdirSync(input.workspacePath, { recursive: true });
    this.db
      .prepare(
        `INSERT INTO projects (id, name, slug, workspace_path, preview_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'stopped', ?, ?)`,
      )
      .run(id, input.name, input.slug, input.workspacePath, ts, ts);
    return this.getProject(id)!;
  }

  getProject(id: string): ProjectRecord | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.mapProject(row);
  }

  listProjects(): ProjectRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapProject(r));
  }

  updateProjectPreview(
    projectId: string,
    previewPort: number | undefined,
    previewStatus: 'stopped' | 'running' | 'error',
  ): void {
    this.db
      .prepare(
        'UPDATE projects SET preview_port = ?, preview_status = ?, updated_at = ? WHERE id = ?',
      )
      .run(previewPort ?? null, previewStatus, nowIso(), projectId);
  }

  touchProject(projectId: string): void {
    this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(nowIso(), projectId);
  }

  private mapProject(row: Record<string, unknown>): ProjectRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      workspacePath: String(row.workspace_path),
      previewPort: typeof row.preview_port === 'number' ? row.preview_port : undefined,
      previewStatus: (row.preview_status as ProjectRecord['previewStatus']) ?? 'stopped',
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  // ---- Runs ----

  createRun(input: {
    id?: string;
    projectId: string;
    prompt: string;
    language: LanguageCode;
    provider: ProviderKind;
    isOfflineDemo: boolean;
    reasoningModel: string;
    fastModel: string;
  }): RunRecord {
    const id = input.id ?? `run-${randomUUID().slice(0, 8)}`;
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO runs (
          id, project_id, prompt, language, status, provider, is_offline_demo,
          reasoning_model, fast_model, total_tokens, total_cost_usd, current_phase, iteration,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, 0, 0, 'understand', 0, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.prompt,
        input.language,
        input.provider,
        input.isOfflineDemo ? 1 : 0,
        input.reasoningModel,
        input.fastModel,
        ts,
        ts,
      );
    this.touchProject(input.projectId);
    return this.getRun(id)!;
  }

  getRun(id: string): RunRecord | null {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.mapRun(row);
  }

  listRunsForProject(projectId: string): RunRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRun(r));
  }

  updateRunState(
    runId: string,
    patch: {
      status?: RunStatus;
      currentPhase?: LoopPhase;
      iteration?: number;
      totalTokens?: number;
      totalCostUsd?: number;
      finalSummary?: string;
      checkpoint?: RunCheckpoint;
    },
  ): void {
    const existing = this.getRun(runId);
    if (!existing) return;

    this.db
      .prepare(
        `UPDATE runs SET
          status = ?,
          current_phase = ?,
          iteration = ?,
          total_tokens = ?,
          total_cost_usd = ?,
          final_summary = ?,
          checkpoint_json = ?,
          updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.status ?? existing.status,
        patch.currentPhase ?? existing.currentPhase,
        patch.iteration ?? existing.iteration,
        patch.totalTokens ?? existing.totalTokens,
        patch.totalCostUsd ?? existing.totalCostUsd,
        patch.finalSummary !== undefined ? patch.finalSummary : existing.finalSummary ?? null,
        patch.checkpoint !== undefined
          ? JSON.stringify(patch.checkpoint)
          : existing.checkpoint
            ? JSON.stringify(existing.checkpoint)
            : null,
        nowIso(),
        runId,
      );
  }

  private mapRun(row: Record<string, unknown>): RunRecord {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      prompt: String(row.prompt),
      language: (row.language as LanguageCode) ?? 'en',
      status: row.status as RunStatus,
      provider: row.provider as ProviderKind,
      isOfflineDemo: Number(row.is_offline_demo) === 1,
      reasoningModel: String(row.reasoning_model),
      fastModel: String(row.fast_model),
      totalTokens: Number(row.total_tokens ?? 0),
      totalCostUsd: Number(row.total_cost_usd ?? 0),
      currentPhase: (row.current_phase as LoopPhase) ?? 'understand',
      iteration: Number(row.iteration ?? 0),
      finalSummary: typeof row.final_summary === 'string' ? row.final_summary : undefined,
      checkpoint: safeJsonParse<RunCheckpoint | undefined>(row.checkpoint_json, undefined),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  // ---- Messages ----

  addMessage(input: {
    runId: string;
    projectId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, unknown>;
  }): ChatMessageRecord {
    const id = `msg-${randomUUID().slice(0, 8)}`;
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO messages (id, run_id, project_id, role, content, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.runId,
        input.projectId,
        input.role,
        input.content,
        input.metadata ? JSON.stringify(input.metadata) : null,
        ts,
      );
    return {
      id,
      runId: input.runId,
      projectId: input.projectId,
      role: input.role,
      content: input.content,
      metadata: input.metadata,
      createdAt: ts,
    };
  }

  listMessages(projectId: string): ChatMessageRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE project_id = ? ORDER BY created_at ASC')
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      runId: String(r.run_id),
      projectId: String(r.project_id),
      role: r.role as ChatMessageRecord['role'],
      content: String(r.content),
      metadata: safeJsonParse<Record<string, unknown> | undefined>(r.metadata_json, undefined),
      createdAt: String(r.created_at),
    }));
  }

  // ---- Action Logs ----

  appendActionLog(
    entry: Omit<ActionLogEntry, 'id' | 'seq' | 'createdAt'>,
  ): ActionLogEntry {
    const id = `log-${randomUUID().slice(0, 8)}`;
    const seqRow = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM action_logs WHERE run_id = ?')
      .get(entry.runId) as { maxSeq: number };
    const seq = Number(seqRow?.maxSeq ?? 0) + 1;
    const ts = nowIso();

    this.db
      .prepare(
        `INSERT INTO action_logs (
          id, run_id, seq, role, phase, event_type, tool_name, summary,
          input_json, output_json, status, duration_ms, tokens_used, cost_usd,
          model_used, model_tier, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        entry.runId,
        seq,
        entry.role,
        entry.phase,
        entry.eventType,
        entry.toolName ?? null,
        entry.summary,
        entry.input !== undefined ? JSON.stringify(entry.input) : null,
        entry.output !== undefined ? JSON.stringify(entry.output) : null,
        entry.status,
        entry.durationMs,
        entry.tokensUsed,
        entry.costUsd,
        entry.modelUsed ?? null,
        entry.modelTier ?? null,
        ts,
      );

    return {
      ...entry,
      id,
      seq,
      createdAt: ts,
    };
  }

  listActionLogs(runId: string): ActionLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM action_logs WHERE run_id = ? ORDER BY seq ASC')
      .all(runId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      runId: String(r.run_id),
      seq: Number(r.seq),
      role: r.role as ActionLogEntry['role'],
      phase: r.phase as LoopPhase,
      eventType: r.event_type as ActionLogEntry['eventType'],
      toolName: typeof r.tool_name === 'string' ? r.tool_name : undefined,
      summary: String(r.summary),
      input: safeJsonParse<unknown>(r.input_json, undefined),
      output: safeJsonParse<unknown>(r.output_json, undefined),
      status: r.status as ActionLogEntry['status'],
      durationMs: Number(r.duration_ms ?? 0),
      tokensUsed: Number(r.tokens_used ?? 0),
      costUsd: Number(r.cost_usd ?? 0),
      modelUsed: typeof r.model_used === 'string' ? r.model_used : undefined,
      modelTier:
        r.model_tier === 'reasoning' || r.model_tier === 'fast' ? r.model_tier : undefined,
      createdAt: String(r.created_at),
    }));
  }

  // ---- Project Notes & Long-Term Memory ----

  upsertProjectNote(projectId: string, key: string, content: string): ProjectNote {
    const id = `note-${randomUUID().slice(0, 8)}`;
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO project_notes (id, project_id, key, content, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
      )
      .run(id, projectId, key, content, ts);
    return { id, projectId, key, content, updatedAt: ts };
  }

  listProjectNotes(projectId: string): ProjectNote[] {
    const rows = this.db
      .prepare('SELECT * FROM project_notes WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      key: String(r.key),
      content: String(r.content),
      updatedAt: String(r.updated_at),
    }));
  }

  addMemory(input: {
    category: MemoryItem['category'];
    title: string;
    content: string;
    tags?: string[];
    sourceRunId?: string;
    confidence?: number;
  }): MemoryItem {
    const existing = this.db
      .prepare('SELECT id FROM long_term_memory WHERE title = ? AND category = ?')
      .get(input.title, input.category) as { id: string } | undefined;

    const ts = nowIso();
    if (existing) {
      this.db
        .prepare(
          'UPDATE long_term_memory SET content = ?, hits = hits + 1, confidence = ? WHERE id = ?',
        )
        .run(input.content, input.confidence ?? 0.85, existing.id);
      return this.listMemories().find((m) => m.id === existing.id)!;
    }

    const id = `mem-${randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        `INSERT INTO long_term_memory (id, category, title, content, tags_json, source_run_id, confidence, hits, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        id,
        input.category,
        input.title,
        input.content,
        JSON.stringify(input.tags ?? []),
        input.sourceRunId ?? null,
        input.confidence ?? 0.8,
        ts,
      );
    return {
      id,
      category: input.category,
      title: input.title,
      content: input.content,
      tags: input.tags ?? [],
      sourceRunId: input.sourceRunId,
      confidence: input.confidence ?? 0.8,
      hits: 0,
      createdAt: ts,
    };
  }

  listMemories(limit = 50): MemoryItem[] {
    const rows = this.db
      .prepare('SELECT * FROM long_term_memory ORDER BY hits DESC, created_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      category: r.category as MemoryItem['category'],
      title: String(r.title),
      content: String(r.content),
      tags: safeJsonParse<string[]>(r.tags_json, []),
      sourceRunId: typeof r.source_run_id === 'string' ? r.source_run_id : undefined,
      confidence: Number(r.confidence ?? 0.8),
      hits: Number(r.hits ?? 0),
      createdAt: String(r.created_at),
    }));
  }

  searchMemories(query: string, limit = 6): MemoryItem[] {
    const terms = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3);
    const all = this.listMemories(100);
    if (terms.length === 0) return all.slice(0, limit);

    const scored = all
      .map((item) => {
        const hay = `${item.title} ${item.content} ${item.tags.join(' ')}`.toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (hay.includes(t)) score += 1;
        }
        return { item, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.item.confidence - a.item.confidence);

    const selected = (scored.length > 0 ? scored.map((s) => s.item) : all).slice(0, limit);
    for (const item of selected) {
      this.db.prepare('UPDATE long_term_memory SET hits = hits + 1 WHERE id = ?').run(item.id);
    }
    return selected;
  }

  // ---- Evals ----

  saveEvalRun(input: Omit<EvalRunRecord, 'id' | 'createdAt'>): EvalRunRecord {
    const id = `eval-${randomUUID().slice(0, 8)}`;
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO eval_runs (
          id, suite_version, provider, total_tasks, passed, failed,
          total_duration_ms, results_json, regressions_json, improvements_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.suiteVersion,
        input.provider,
        input.totalTasks,
        input.passed,
        input.failed,
        input.totalDurationMs,
        JSON.stringify(input.results),
        JSON.stringify(input.regressions),
        JSON.stringify(input.improvements),
        ts,
      );
    return { ...input, id, createdAt: ts };
  }

  listEvalRuns(limit = 20): EvalRunRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM eval_runs ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      suiteVersion: String(r.suite_version),
      provider: r.provider as ProviderKind,
      totalTasks: Number(r.total_tasks),
      passed: Number(r.passed),
      failed: Number(r.failed),
      totalDurationMs: Number(r.total_duration_ms),
      results: safeJsonParse(r.results_json, []),
      regressions: safeJsonParse(r.regressions_json, []),
      improvements: safeJsonParse(r.improvements_json, []),
      createdAt: String(r.created_at),
    }));
  }

  getLatestEvalRun(): EvalRunRecord | null {
    return this.listEvalRuns(1)[0] ?? null;
  }
}
