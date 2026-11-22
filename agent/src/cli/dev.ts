import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { AxiomOrchestrator } from '../core/orchestrator.ts';
import { loadConfig } from '../llm/config.ts';
import { AxiomStore } from '../memory/store.ts';
import { createServerApp } from '../server/app.ts';

const rootDir = path.resolve(import.meta.dirname, '../..');
const config = loadConfig(process.env, rootDir);
const store = new AxiomStore(path.join(config.dataDir, 'axiom.sqlite'));
const orchestrator = new AxiomOrchestrator({ config, store });

const apiPort = config.apiPort;
const uiPort = Number(process.env.PORT || 5173);

const app = createServerApp({ config, orchestrator });
const apiServer = app.listen(apiPort, '127.0.0.1', () => {
  console.log(`Axiom API listening on 127.0.0.1:${apiPort} (provider=${config.activeProvider})`);
});

const viteBin = path.join(rootDir, 'node_modules', '.bin', 'vite');
const viteProc = spawn(viteBin, ['--host', '0.0.0.0', '--port', String(uiPort)], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    API_PORT: String(apiPort),
    PORT: String(uiPort),
  },
});

async function shutdown() {
  viteProc.kill('SIGTERM');
  await orchestrator.previewManager.stopAll();
  apiServer.close(() => {
    store.close();
    process.exit(0);
  });
}

viteProc.on('exit', (code) => {
  void shutdown().then(() => process.exit(code ?? 0));
});

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
