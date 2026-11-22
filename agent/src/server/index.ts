import 'dotenv/config';
import path from 'node:path';
import { AxiomOrchestrator } from '../core/orchestrator.ts';
import { loadConfig } from '../llm/config.ts';
import { AxiomStore } from '../memory/store.ts';
import { createServerApp } from './app.ts';

const rootDir = path.resolve(import.meta.dirname, '../..');
const config = loadConfig(process.env, rootDir);
const store = new AxiomStore(path.join(config.dataDir, 'axiom.sqlite'));
const orchestrator = new AxiomOrchestrator({ config, store });

const clientDistDir = path.join(rootDir, 'dist', 'client');
const app = createServerApp({ config, orchestrator, clientDistDir });

const port = Number(process.env.PORT || config.port || 3000);
const server = app.listen(port, config.host, () => {
  console.log(
    `Axiom Studio server listening at http://${config.host}:${port} (provider=${config.activeProvider}, reasoning=${config.reasoningModel}, fast=${config.fastModel})`,
  );
});

async function shutdown() {
  await orchestrator.previewManager.stopAll();
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
