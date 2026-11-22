import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { toProviderStatus, type AxiomConfig } from '../llm/config.ts';
import type { AxiomOrchestrator } from '../core/orchestrator.ts';
import { runEvalSuite } from '../evals/suite.ts';
import { zipDirectory } from './zip.ts';

export function createServerApp(params: {
  config: AxiomConfig;
  orchestrator: AxiomOrchestrator;
  clientDistDir?: string;
}): express.Express {
  const { config, orchestrator } = params;
  const app = express();

  app.use(express.json({ limit: '2mb' }));

  // Allow live preview embedding in Arena / local studio iframes
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  // ---- API ROUTES ----
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      status: toProviderStatus(config),
      brain: orchestrator.getBrainStatus(),
      toolsCount: orchestrator.registry.list().length,
      plugins: orchestrator.registry.listPlugins(),
    });
  });

  app.get('/api/brain', (_req, res) => {
    res.json({ brain: orchestrator.getBrainStatus() });
  });

  app.post('/api/brain/train', (_req, res) => {
    const brain = orchestrator.retrainBrain();
    res.json({ brain });
  });

  app.post('/api/brain/classify', (req, res) => {
    const prompt = String(req.body?.prompt ?? '').trim();
    if (!prompt) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }
    res.json({ classification: orchestrator.classifyPrompt(prompt) });
  });

  app.get('/api/tools', (_req, res) => {
    res.json({
      tools: orchestrator.registry.list().map((t) => ({
        name: t.name,
        description: t.description,
        source: t.source,
        annotations: t.annotations,
      })),
      plugins: orchestrator.registry.listPlugins(),
    });
  });

  app.get('/api/projects', (_req, res) => {
    res.json({ projects: orchestrator.store.listProjects() });
  });

  app.post('/api/projects', (req, res) => {
    const name = String(req.body?.name ?? '').trim() || 'Untitled Project';
    const project = orchestrator.createProject(name);
    res.status(201).json({ project });
  });

  app.get('/api/projects/:id', (req, res) => {
    const project = orchestrator.store.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const runs = orchestrator.store.listRunsForProject(project.id);
    const messages = orchestrator.store.listMessages(project.id);
    const files = orchestrator.listProjectFiles(project.id);
    const notes = orchestrator.store.listProjectNotes(project.id);
    const latestRun = runs[0];
    const logs = latestRun ? orchestrator.store.listActionLogs(latestRun.id) : [];

    res.json({ project, runs, messages, files, notes, logs });
  });

  app.get('/api/projects/:id/file', (req, res) => {
    const relPath = String(req.query.path ?? '');
    if (!relPath) {
      res.status(400).json({ error: 'Missing path query parameter' });
      return;
    }
    try {
      const content = orchestrator.readProjectFile(req.params.id, relPath);
      res.json({ path: relPath, content });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'File error' });
    }
  });

  app.get('/api/projects/:id/download', (req, res) => {
    const project = orchestrator.store.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const zipBuf = zipDirectory(project.workspacePath);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${project.slug}-webapp.zip"`);
    res.send(zipBuf);
  });

  const downloadsDir = path.resolve(config.dataDir, '..', 'downloads');
  const apkFilePath = path.join(downloadsDir, 'axiom-studio-debug.apk');
  let cachedReleaseApk: {
    checkedAt: number;
    asset?: { name: string; size: number; updatedAt: string; url: string };
  } = { checkedAt: 0 };

  async function resolveReleaseApk(): Promise<
    { name: string; size: number; updatedAt: string; url: string } | undefined
  > {
    if (Date.now() - cachedReleaseApk.checkedAt < 60_000) {
      return cachedReleaseApk.asset;
    }
    try {
      const resp = await fetch(
        'https://api.github.com/repos/Rusindu12/claude-mem/releases/tags/axiom-studio-apk',
        {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Axiom-Studio' },
          signal: AbortSignal.timeout(2500),
        },
      );
      if (resp.ok) {
        const rel = (await resp.json()) as {
          assets?: Array<{
            name: string;
            size: number;
            updated_at: string;
            browser_download_url: string;
          }>;
        };
        const apkAsset = rel.assets?.find((a) => a.name.endsWith('.apk'));
        if (apkAsset) {
          cachedReleaseApk = {
            checkedAt: Date.now(),
            asset: {
              name: apkAsset.name,
              size: apkAsset.size,
              updatedAt: apkAsset.updated_at,
              url: apkAsset.browser_download_url,
            },
          };
          return cachedReleaseApk.asset;
        }
      }
    } catch {
      // Ignore offline/network errors
    }
    cachedReleaseApk = { checkedAt: Date.now(), asset: undefined };
    return undefined;
  }

  app.get('/api/downloads/status', async (_req, res) => {
    const apkExists = fs.existsSync(apkFilePath);
    let apkInfo: {
      ready: boolean;
      filename: string;
      sizeBytes?: number;
      sha256?: string;
      updatedAt?: string;
      url?: string;
    } = { ready: false, filename: 'axiom-studio.apk' };

    if (apkExists) {
      const stat = fs.statSync(apkFilePath);
      const hash = crypto.createHash('sha256').update(fs.readFileSync(apkFilePath)).digest('hex');
      apkInfo = {
        ready: true,
        filename: 'axiom-studio.apk',
        sizeBytes: stat.size,
        sha256: hash,
        updatedAt: stat.mtime.toISOString(),
        url: '/api/downloads/apk',
      };
    } else {
      const releaseAsset = await resolveReleaseApk();
      if (releaseAsset) {
        apkInfo = {
          ready: true,
          filename: releaseAsset.name,
          sizeBytes: releaseAsset.size,
          updatedAt: releaseAsset.updatedAt,
          url: releaseAsset.url,
        };
      }
    }

    const webReady = Boolean(params.clientDistDir && fs.existsSync(params.clientDistDir));
    res.json({
      apk: apkInfo,
      webApp: {
        ready: webReady,
        filename: 'axiom-studio-webapp.zip',
        url: '/api/downloads/webapp',
        pwaInstallable: true,
      },
    });
  });

  app.get('/api/downloads/apk', async (_req, res) => {
    if (fs.existsSync(apkFilePath)) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="axiom-studio.apk"');
      fs.createReadStream(apkFilePath).pipe(res);
      return;
    }
    const releaseAsset = await resolveReleaseApk();
    if (releaseAsset) {
      res.redirect(302, releaseAsset.url);
      return;
    }
    res.status(404).json({
      error: 'APK artifact not built yet. Trigger .github/workflows/axiom-android-apk.yml or run npm run apk:build with Android SDK.',
    });
  });

  app.get('/api/downloads/webapp', (_req, res) => {
    if (!params.clientDistDir || !fs.existsSync(params.clientDistDir)) {
      res.status(404).json({ error: 'Built Web App dist/client not found; run npm run build first.' });
      return;
    }
    const zipBuf = zipDirectory(params.clientDistDir);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="axiom-studio-webapp.zip"');
    res.send(zipBuf);
  });

  app.post('/api/runs', (req, res) => {
    const prompt = String(req.body?.prompt ?? '').trim();
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : undefined;
    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required' });
      return;
    }

    const { project, run } = orchestrator.startRunAsync({ projectId, prompt });
    res.status(201).json({ project, run });
  });

  app.get('/api/runs/:id', (req, res) => {
    const run = orchestrator.store.getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    const logs = orchestrator.store.listActionLogs(run.id);
    res.json({ run, logs });
  });

  app.get('/api/runs/:id/stream', (req, res) => {
    const runId = req.params.id;
    const run = orchestrator.store.getRun(runId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Send initial snapshot
    sendEvent('snapshot', {
      run,
      logs: orchestrator.store.listActionLogs(runId),
    });

    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      res.end();
      return;
    }

    const unsubscribe = orchestrator.subscribeRun(runId, (ev) => {
      sendEvent(ev.type, ev);
      if (
        ev.type === 'run_update' &&
        (ev.run.status === 'completed' ||
          ev.run.status === 'failed' ||
          ev.run.status === 'cancelled' ||
          ev.run.status === 'awaiting_confirmation')
      ) {
        setTimeout(() => {
          unsubscribe();
          res.end();
        }, 50);
      }
    });

    req.on('close', () => {
      unsubscribe();
    });
  });

  app.post('/api/runs/:id/confirm', (req, res) => {
    const run = orchestrator.store.getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    const approved = Boolean(req.body?.approved);
    void orchestrator.confirmRun(run.id, approved);
    res.json({ ok: true, runId: run.id, approved });
  });

  app.post('/api/runs/:id/resume', (req, res) => {
    const run = orchestrator.store.getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    void orchestrator.resumeRun(run.id);
    res.json({ ok: true, runId: run.id });
  });

  app.get('/api/memory', (_req, res) => {
    res.json({ memories: orchestrator.store.listMemories(100) });
  });

  app.post('/api/memory', (req, res) => {
    const title = String(req.body?.title ?? '').trim();
    const content = String(req.body?.content ?? '').trim();
    const category =
      (req.body?.category as 'lesson' | 'preference' | 'pattern' | 'architecture') || 'preference';
    if (!title || !content) {
      res.status(400).json({ error: 'title and content are required' });
      return;
    }
    const item = orchestrator.store.addMemory({ category, title, content, tags: ['user'] });
    res.status(201).json({ memory: item });
  });

  app.get('/api/evals', (_req, res) => {
    res.json({ evalRuns: orchestrator.store.listEvalRuns(20) });
  });

  app.post('/api/evals/run', async (_req, res) => {
    try {
      const report = await runEvalSuite({ config, store: orchestrator.store });
      res.json({ evalRun: report });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Eval failed' });
    }
  });

  // ---- LIVE PREVIEW REVERSE PROXY (/preview/:projectId/*) ----
  app.use('/preview/:projectId', async (req, res) => {
    const projectId = req.params.projectId;

    // Ensure trailing slash on base preview URL so relative ./styles.css works cleanly
    if (req.originalUrl === `/preview/${projectId}`) {
      res.redirect(302, `/preview/${projectId}/`);
      return;
    }

    const port = await orchestrator.ensureProjectPreview(projectId);
    if (!port) {
      res
        .status(404)
        .send('<html><body style="font-family:sans-serif;background:#0b0f17;color:#94a3b8;padding:2rem;"><h2>Preview not available yet</h2><p>Build a web project first to render a live preview.</p></body></html>');
      return;
    }

    const targetPath = req.url && req.url !== '' ? req.url : '/';
    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: targetPath,
        method: req.method,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${port}`,
        },
      },
      (proxyRes) => {
        const headers = { ...proxyRes.headers };
        // Remove restrictive framing headers so studio iframe works smoothly
        delete headers['x-frame-options'];
        res.writeHead(proxyRes.statusCode ?? 200, headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).send(`Preview proxy error: ${err.message}`);
      }
    });

    if (req.readable && req.method !== 'GET' && req.method !== 'HEAD') {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  });

  // ---- STATIC BUILT CLIENT (when dist/client exists) ----
  if (params.clientDistDir && fs.existsSync(params.clientDistDir)) {
    app.use(express.static(params.clientDistDir));
    app.use((req, res, next) => {
      if (
        (req.method !== 'GET' && req.method !== 'HEAD') ||
        req.path.startsWith('/api/') ||
        req.path.startsWith('/preview/')
      ) {
        next();
        return;
      }
      res.sendFile(path.join(params.clientDistDir!, 'index.html'));
    });
  }

  return app;
}
