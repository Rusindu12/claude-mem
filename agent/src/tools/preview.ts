import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AxiomStore } from '../memory/store.ts';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export interface PreviewInstance {
  projectId: string;
  port: number;
  rootDir: string;
  server: http.Server;
}

export class PreviewManager {
  private instances = new Map<string, PreviewInstance>();
  private store: AxiomStore;

  constructor(store: AxiomStore) {
    this.store = store;
  }

  getPort(projectId: string): number | undefined {
    return this.instances.get(projectId)?.port;
  }

  async startStaticPreview(projectId: string, rootDir: string): Promise<{ port: number; url: string }> {
    await this.stopPreview(projectId);

    const resolvedRoot = path.resolve(rootDir);
    if (!fs.existsSync(resolvedRoot)) {
      throw new Error(`Preview root does not exist: ${resolvedRoot}`);
    }

    // Provision local Three.js ES modules when workspace references ./vendor/three.module.js
    const gameJsPath = path.join(resolvedRoot, 'game.js');
    if (
      fs.existsSync(gameJsPath) &&
      fs.readFileSync(gameJsPath, 'utf8').includes('./vendor/three.module.js')
    ) {
      const threeBuildDir = path.resolve(import.meta.dirname, '../../node_modules/three/build');
      const targetVendorDir = path.join(resolvedRoot, 'vendor');
      if (fs.existsSync(path.join(threeBuildDir, 'three.module.js'))) {
        fs.mkdirSync(targetVendorDir, { recursive: true });
        for (const fileName of ['three.module.js', 'three.core.js']) {
          const dest = path.join(targetVendorDir, fileName);
          if (!fs.existsSync(dest)) {
            fs.copyFileSync(path.join(threeBuildDir, fileName), dest);
          }
        }
      }
    }

    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      let relPath = decodeURIComponent(reqUrl.pathname).replace(/^\/+/, '');
      if (!relPath) relPath = 'index.html';

      let target = path.resolve(resolvedRoot, relPath);
      if (!target.startsWith(resolvedRoot)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        target = path.join(target, 'index.html');
      }

      if (!fs.existsSync(target)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      const ext = path.extname(target).toLowerCase();
      res.writeHead(200, {
        'content-type': MIME_TYPES[ext] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      fs.createReadStream(target).pipe(res);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    if (!port) {
      server.close();
      throw new Error('Failed to bind ephemeral preview port');
    }

    this.instances.set(projectId, { projectId, port, rootDir: resolvedRoot, server });
    this.store.updateProjectPreview(projectId, port, 'running');
    return { port, url: `/preview/${projectId}/` };
  }

  async stopPreview(projectId: string): Promise<void> {
    const existing = this.instances.get(projectId);
    if (existing) {
      this.instances.delete(projectId);
      await new Promise<void>((resolve) => existing.server.close(() => resolve()));
    }
    this.store.updateProjectPreview(projectId, undefined, 'stopped');
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.instances.keys());
    for (const id of ids) {
      await this.stopPreview(id);
    }
  }
}
