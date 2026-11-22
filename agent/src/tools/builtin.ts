import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  assessCommandSafety,
  assertSafeExternalUrl,
  redactSecrets,
  resolveWorkspacePath,
  wrapUntrustedData,
} from '../core/security.ts';
import type { ToolRegistry, ToolResult } from './registry.ts';
import { verifyWebApp } from './verifier.ts';

const execAsync = promisify(exec);

function listFilesRecursive(rootDir: string, maxFiles = 200): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    if (results.length >= maxFiles || !fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (results.length >= maxFiles) break;
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else {
        results.push(path.relative(rootDir, full));
      }
    }
  }
  walk(rootDir);
  return results.sort();
}

export function registerBuiltinTools(registry: ToolRegistry): void {
  registry.register({
    name: 'repo_map',
    description: 'List project workspace files and extract top-level symbols/headings for quick navigation.',
    source: 'builtin',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        maxFiles: { type: 'number', description: 'Maximum files to inspect (default 60)' },
      },
    },
    async execute(args, ctx): Promise<ToolResult> {
      const maxFiles = Math.min(200, Number(args.maxFiles ?? 60));
      const files = listFilesRecursive(ctx.workspacePath, maxFiles);
      const mapEntries = files.map((rel) => {
        const full = path.join(ctx.workspacePath, rel);
        const stat = fs.statSync(full);
        const symbols: string[] = [];
        if (stat.size < 64_000 && /\.(ts|tsx|js|mjs|html|md)$/.test(rel)) {
          const text = fs.readFileSync(full, 'utf8');
          const matches = text.match(/^(?:export\s+(?:async\s+)?(?:function|class|const)\s+\w+|#\s+.+|<title>[^<]+<\/title>)/gm);
          if (matches) symbols.push(...matches.slice(0, 6));
        }
        return { path: rel, bytes: stat.size, symbols };
      });
      return {
        ok: true,
        output: { files: mapEntries },
        summary: `Mapped ${files.length} workspace file(s)`,
      };
    },
  });

  registry.register({
    name: 'read_file',
    description: 'Read a file inside the project workspace (wrapped as untrusted data).',
    source: 'builtin',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        startLine: { type: 'number' },
        endLine: { type: 'number' },
      },
      required: ['path'],
    },
    async execute(args, ctx): Promise<ToolResult> {
      const relPath = String(args.path ?? '');
      const abs = resolveWorkspacePath(ctx.workspacePath, relPath);
      if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
        return { ok: false, output: { error: `File not found: ${relPath}` }, summary: `File missing: ${relPath}` };
      }
      const raw = fs.readFileSync(abs, 'utf8');
      const lines = raw.split('\n');
      const start = Math.max(1, Number(args.startLine ?? 1));
      const end = Math.min(lines.length, Number(args.endLine ?? lines.length));
      const slice = lines.slice(start - 1, end).join('\n').slice(0, 40_000);
      const { wrapped, injectionSignals } = wrapUntrustedData(`file:${relPath}`, slice);

      return {
        ok: true,
        output: { path: relPath, content: wrapped, injectionSignals, totalLines: lines.length },
        summary:
          injectionSignals.length > 0
            ? `Read ${relPath} (${injectionSignals.length} prompt-injection signal(s) neutralized)`
            : `Read ${relPath} (${lines.length} lines)`,
      };
    },
  });

  registry.register({
    name: 'write_file',
    description: 'Create or overwrite a file inside the project workspace.',
    source: 'builtin',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        content: { type: 'string', description: 'Complete file content' },
      },
      required: ['path', 'content'],
    },
    async execute(args, ctx): Promise<ToolResult> {
      const relPath = String(args.path ?? '');
      const content = String(args.content ?? '');
      const abs = resolveWorkspacePath(ctx.workspacePath, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      return {
        ok: true,
        output: { path: relPath, bytes: Buffer.byteLength(content, 'utf8') },
        summary: `Wrote ${relPath} (${Buffer.byteLength(content, 'utf8')} bytes)`,
      };
    },
  });

  registry.register({
    name: 'edit_file',
    description: 'Replace an exact text snippet in an existing workspace file.',
    source: 'builtin',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        oldText: { type: 'string' },
        newText: { type: 'string' },
      },
      required: ['path', 'oldText', 'newText'],
    },
    async execute(args, ctx): Promise<ToolResult> {
      const relPath = String(args.path ?? '');
      const oldText = String(args.oldText ?? '');
      const newText = String(args.newText ?? '');
      const abs = resolveWorkspacePath(ctx.workspacePath, relPath);
      if (!fs.existsSync(abs)) {
        return { ok: false, output: { error: `File not found: ${relPath}` }, summary: `Missing ${relPath}` };
      }
      const existing = fs.readFileSync(abs, 'utf8');
      const idx = existing.indexOf(oldText);
      if (idx === -1) {
        return {
          ok: false,
          output: { error: 'oldText not found in file' },
          summary: `Edit failed: target text not found in ${relPath}`,
        };
      }
      const updated = existing.slice(0, idx) + newText + existing.slice(idx + oldText.length);
      fs.writeFileSync(abs, updated, 'utf8');
      return {
        ok: true,
        output: { path: relPath, updated: true },
        summary: `Updated ${relPath}`,
      };
    },
  });

  registry.register({
    name: 'run_command',
    description: 'Execute a sandboxed shell command inside the project workspace (destructive commands require user confirmation).',
    source: 'builtin',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
      required: ['command'],
    },
    async execute(args, ctx): Promise<ToolResult> {
      const command = String(args.command ?? '');
      const safety = assessCommandSafety(command);
      if (safety.decision === 'deny') {
        return {
          ok: false,
          output: { blocked: true, reason: safety.reason },
          summary: `Blocked dangerous command: ${safety.reason}`,
        };
      }
      if (safety.decision === 'confirm_required' && !ctx.approvedConfirmationId) {
        return {
          ok: false,
          output: { awaitingConfirmation: true, reason: safety.reason, command },
          summary: `Confirmation required: ${safety.reason}`,
          requiresConfirmation: {
            toolName: 'run_command',
            reason: safety.reason ?? 'Destructive command requires confirmation',
            args: { command },
          },
        };
      }

      const timeout = Math.min(120_000, Number(args.timeoutMs ?? ctx.cmdTimeoutMs));
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: ctx.workspacePath,
          timeout,
          maxBuffer: 1024 * 1024,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_ENV: process.env.NODE_ENV ?? 'development',
          },
        });
        const cleanOut = redactSecrets(stdout).slice(0, 12_000);
        const cleanErr = redactSecrets(stderr).slice(0, 6_000);
        const { wrapped } = wrapUntrustedData(`cmd:${command}`, `${cleanOut}\n${cleanErr}`.trim());
        return {
          ok: true,
          output: { exitCode: 0, stdout: cleanOut, stderr: cleanErr, wrapped },
          summary: `Command passed (exit 0): ${command}`,
        };
      } catch (err) {
        const execErr = err as { code?: number; stdout?: string; stderr?: string; message?: string };
        const cleanOut = redactSecrets(execErr.stdout ?? '').slice(0, 6_000);
        const cleanErr = redactSecrets(execErr.stderr ?? execErr.message ?? '').slice(0, 6_000);
        return {
          ok: false,
          output: { exitCode: execErr.code ?? 1, stdout: cleanOut, stderr: cleanErr },
          summary: `Command failed (exit ${execErr.code ?? 1}): ${command}`,
        };
      }
    },
  });

  registry.register({
    name: 'git_ops',
    description: 'Run safe git operations scoped to the project workspace (status, diff, init, commit).',
    source: 'builtin',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'diff', 'init', 'commit'] },
        message: { type: 'string' },
      },
      required: ['action'],
    },
    async execute(args, ctx): Promise<ToolResult> {
      const action = String(args.action ?? 'status');
      const runGit = async (cmd: string) =>
        execAsync(cmd, { cwd: ctx.workspacePath, timeout: 10_000 });

      try {
        if (action === 'init') {
          if (!fs.existsSync(path.join(ctx.workspacePath, '.git'))) {
            await runGit('git init');
          }
          return { ok: true, output: { initialized: true }, summary: 'Initialized project git repository' };
        }
        if (action === 'status') {
          const { stdout } = await runGit('git status --short');
          return { ok: true, output: { status: stdout.trim() }, summary: 'Checked git status' };
        }
        if (action === 'diff') {
          const { stdout } = await runGit('git diff');
          return { ok: true, output: { diff: stdout.slice(0, 12_000) }, summary: 'Retrieved git diff' };
        }
        if (action === 'commit') {
          if (!fs.existsSync(path.join(ctx.workspacePath, '.git'))) {
            await runGit('git init');
          }
          const msg = String(args.message ?? 'chore: checkpoint by Axiom').replace(/"/g, '\\"');
          await runGit('git add -A');
          const { stdout } = await runGit(
            `git -c user.name="Axiom Agent" -c user.email="axiom@local" commit -m "${msg}"`,
          );
          return { ok: true, output: { committed: stdout.trim() }, summary: `Committed workspace: ${msg}` };
        }
        return { ok: false, output: { error: `Unknown git action: ${action}` }, summary: 'Unknown git action' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, output: { error: msg }, summary: `git ${action} failed` };
      }
    },
  });

  registry.register({
    name: 'fetch_page',
    description: 'Fetch a public web page safely (SSRF-guarded, prompt-injection wrapped as untrusted data).',
    source: 'builtin',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
      },
      required: ['url'],
    },
    async execute(args): Promise<ToolResult> {
      const rawUrl = String(args.url ?? '');
      try {
        const parsed = assertSafeExternalUrl(rawUrl);
        const res = await fetch(parsed, {
          headers: { 'user-agent': 'Axiom-Agent/0.1 (research-fetcher)' },
          signal: AbortSignal.timeout(10_000),
        });
        const text = await res.text();
        const stripped = text
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 16_000);

        const { wrapped, injectionSignals } = wrapUntrustedData(parsed.toString(), stripped);
        return {
          ok: res.ok,
          output: { url: parsed.toString(), status: res.status, content: wrapped, injectionSignals },
          summary: `Fetched ${parsed.hostname} (HTTP ${res.status})`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, output: { error: msg }, summary: `Fetch blocked/failed: ${msg}` };
      }
    },
  });

  registry.register({
    name: 'start_preview',
    description: 'Start the live preview server for the project workspace and return its relative preview URL.',
    source: 'builtin',
    inputSchema: {
      type: 'object',
      properties: {
        entryDir: { type: 'string', description: 'Relative directory to serve (default ".")' },
      },
    },
    async execute(args, ctx): Promise<ToolResult> {
      const rel = String(args.entryDir ?? '.');
      const dir = resolveWorkspacePath(ctx.workspacePath, rel);
      const started = await ctx.previewManager.startStaticPreview(ctx.projectId, dir);
      return {
        ok: true,
        output: { port: started.port, previewUrl: started.url },
        summary: `Live preview running at ${started.url} (internal port ${started.port})`,
      };
    },
  });

  registry.register({
    name: 'verify_web_app',
    description: 'Verify running live preview via HTTP status, local asset integrity, parse5 DOM/a11y audit, CSS responsiveness, and JS syntax check.',
    source: 'builtin',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Entry route path (default "/")' },
      },
    },
    async execute(args, ctx): Promise<ToolResult> {
      let port = ctx.previewManager.getPort(ctx.projectId);
      if (!port) {
        const started = await ctx.previewManager.startStaticPreview(ctx.projectId, ctx.workspacePath);
        port = started.port;
      }
      const entryPath = String(args.path ?? '/');
      const report = await verifyWebApp({
        baseUrl: `http://127.0.0.1:${port}`,
        entryPath,
        workspacePath: ctx.workspacePath,
        previewDisplayUrl: `/preview/${ctx.projectId}/`,
      });
      return {
        ok: report.passed,
        output: report,
        summary: report.passed
          ? `Verification PASSED (${report.checks.length}/${report.checks.length} checks)`
          : `Verification FAILED (${report.checks.filter((c) => !c.passed).map((c) => c.name).join(', ')})`,
      };
    },
  });

  registry.register({
    name: 'memory_read',
    description: 'Search long-term lessons and project notes relevant to a query.',
    source: 'builtin',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
    async execute(args, ctx): Promise<ToolResult> {
      const q = String(args.query ?? '');
      const memories = ctx.store.searchMemories(q, 6);
      const notes = ctx.store.listProjectNotes(ctx.projectId);
      return {
        ok: true,
        output: { memories, projectNotes: notes },
        summary: `Retrieved ${memories.length} long-term memory item(s) and ${notes.length} project note(s)`,
      };
    },
  });

  registry.register({
    name: 'memory_write',
    description: 'Persist a verified lesson learned or per-project architectural note to SQLite memory.',
    source: 'builtin',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['long_term', 'project_note'] },
        category: { type: 'string', enum: ['lesson', 'preference', 'pattern', 'architecture'] },
        title: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'content'],
    },
    async execute(args, ctx): Promise<ToolResult> {
      const scope = String(args.scope ?? 'long_term');
      const title = String(args.title ?? '');
      const content = String(args.content ?? '');
      if (scope === 'project_note') {
        const note = ctx.store.upsertProjectNote(ctx.projectId, title, content);
        return { ok: true, output: note, summary: `Saved project note "${title}"` };
      }
      const cat = (args.category as 'lesson' | 'preference' | 'pattern' | 'architecture') ?? 'lesson';
      const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
      const item = ctx.store.addMemory({
        category: cat,
        title,
        content,
        tags,
        sourceRunId: ctx.runId,
      });
      return { ok: true, output: item, summary: `Stored long-term ${cat}: "${title}"` };
    },
  });

  registry.register({
    name: 'build_android_apk',
    description: 'Check Android JDK/SDK toolchain and compile a Capacitor Android APK inside the workspace when Android SDK is available.',
    source: 'builtin',
    annotations: { destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        variant: { type: 'string', enum: ['debug', 'release'] },
      },
    },
    async execute(args, ctx): Promise<ToolResult> {
      const capCfgPath = path.join(ctx.workspacePath, 'capacitor.config.json');
      if (!fs.existsSync(capCfgPath)) {
        return {
          ok: false,
          output: { error: 'capacitor.config.json not found in workspace' },
          summary: 'Missing capacitor.config.json — scaffold mobile Capacitor config first',
        };
      }

      const hasJava = await execAsync('command -v java', { timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      const androidSdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';
      const hasSdk = Boolean(androidSdk && fs.existsSync(androidSdk));

      if (!hasJava || !hasSdk) {
        return {
          ok: false,
          output: {
            toolchainReady: false,
            hasJava,
            hasAndroidSdk: hasSdk,
            cloudWorkflowAvailable: fs.existsSync(path.join(ctx.workspacePath, '.github/workflows/build-apk.yml')),
            message:
              'Android APK compilation requires Java JDK (17/21) and Android SDK (ANDROID_HOME). Neither is installed in this sandbox; use the generated GitHub Actions workflow (.github/workflows/build-apk.yml) or run on a machine with Android Studio/SDK.',
          },
          summary: `APK toolchain unavailable locally (java=${hasJava}, sdk=${hasSdk}) — Capacitor + GitHub Actions APK bundle ready`,
        };
      }

      const variant = String(args.variant ?? 'debug') === 'release' ? 'assembleRelease' : 'assembleDebug';
      try {
        await execAsync(
          `npx cap sync android && cd android && chmod +x ./gradlew && ./gradlew ${variant}`,
          { cwd: ctx.workspacePath, timeout: 120_000 },
        );
        return {
          ok: true,
          output: { toolchainReady: true, variant, apkDir: 'android/app/build/outputs/apk' },
          summary: `Built Android APK (${variant}) cleanly`,
        };
      } catch (err) {
        return {
          ok: false,
          output: { error: err instanceof Error ? err.message : String(err) },
          summary: 'Gradle APK build failed',
        };
      }
    },
  });
}
