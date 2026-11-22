import 'dotenv/config';
import path from 'node:path';
import { loadConfig } from '../llm/config.ts';
import { AxiomStore } from '../memory/store.ts';
import { runEvalSuite } from './suite.ts';

async function main() {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const config = loadConfig(process.env, rootDir);
  const store = new AxiomStore(path.join(config.dataDir, 'axiom.sqlite'));

  try {
    console.log(`Running Axiom Benchmark Eval Suite (provider=${config.activeProvider})...\n`);
    const report = await runEvalSuite({ config, store });

    for (const r of report.results) {
      const icon = r.passed ? 'PASS' : 'FAIL';
      console.log(`[${icon}] ${r.id} (${r.score}/100, ${r.durationMs}ms) — ${r.name}`);
      for (const c of r.checks) {
        console.log(`   ${c.passed ? '✓' : '✗'} ${c.name}: ${c.details}`);
      }
      if (r.error) console.log(`   Error: ${r.error}`);
    }

    console.log(`\nSummary: ${report.passed}/${report.totalTasks} passed in ${report.totalDurationMs}ms`);
    if (report.regressions.length > 0) {
      console.log(`REGRESSIONS: ${report.regressions.join(', ')}`);
    }
    if (report.improvements.length > 0) {
      console.log(`IMPROVEMENTS: ${report.improvements.join(', ')}`);
    }

    process.exitCode = report.failed > 0 ? 1 : 0;
  } finally {
    store.close();
  }
}

main();
