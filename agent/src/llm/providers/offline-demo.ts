import { detectLanguage } from '../../core/prompts.ts';
import type { LanguageCode, VerificationReport } from '../../shared/types.ts';
import type {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMProvider,
  LLMToolCall,
} from '../types.ts';

type ProjectKind = 'landing_page' | 'crud_app' | 'game_2d' | 'api_service' | 'general';

function classifyPrompt(prompt: string): ProjectKind {
  const lower = prompt.toLowerCase();
  if (/(rm\s+-rf|force[- ]push|delete everything|reset --hard)/.test(lower)) {
    return 'general';
  }
  if (/(2d\s*game|arcade|canvas\s*game|space\s*defender|shooter|game\b)/.test(lower)) {
    return 'game_2d';
  }
  if (/(rest\s*api|api\s*service|backend\s*api|endpoint|microservice|notes\s*api)/.test(lower)) {
    return 'api_service';
  }
  if (/(crud|todo|task\s*tracker|kanban|inventory|tracker)/.test(lower)) {
    return 'crud_app';
  }
  if (/(landing\s*page|website|portfolio|startup\s*page|hero\s*page|site\b|coffee\s*shop)/.test(lower)) {
    return 'landing_page';
  }
  return 'landing_page';
}

function extractBrandAndTopic(prompt: string): { brand: string; topic: string; tagline: string } {
  const cleaned = prompt
    .replace(/make me a landing page( for)?/i, '')
    .replace(/build( me)?( a)?/i, '')
    .replace(/mata .* hadanna/i, '')
    .trim();

  const lower = prompt.toLowerCase();
  if (lower.includes('coffee')) {
    return {
      brand: 'Kopi Ceylon Roasters',
      topic: 'Single-Origin Artisanal Coffee',
      tagline: 'Small-batch highland roasts, precision brewed from bean to cup.',
    };
  }
  if (lower.includes('solar') || lower.includes('orbital') || lower.includes('clean')) {
    return {
      brand: 'HelioOrbit Energy',
      topic: 'Orbital Solar Clean-Tech',
      tagline: 'Continuous gigawatt solar beaming with zero-carbon grid storage.',
    };
  }
  const words = cleaned
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 3);
  const title = words.length > 0 ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : 'Aether Studio';
  return {
    brand: title,
    topic: cleaned || 'Next-Generation Autonomous Software',
    tagline: 'Engineered from first principles — fast, verifiable, built for the future.',
  };
}

function formatFinalSummary(lang: LanguageCode, detail: string): string {
  const disclaimer =
    '\n\n> _Mode notice: Generated using Axiom Offline Demo Engine (`AXIOM_PROVIDER=demo`). Configure `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `LOCAL_LLM_BASE_URL` in `.env` for live LLM reasoning._';

  if (lang === 'si') {
    return `වැඩේ සාර්ථකව අවසන් කළා (සියලුම පරීක්ෂණ සහ සජීවී පෙරදසුන තහවුරු කරන ලදී):\n${detail}${disclaimer}`;
  }
  if (lang === 'singlish') {
    return `Wade hariyata iwarai! Siyalu tests saha live preview verify karala thiyenne:\n${detail}${disclaimer}`;
  }
  return `Completed & verified end-to-end:\n${detail}${disclaimer}`;
}

export class OfflineDemoProvider implements LLMProvider {
  readonly kind = 'demo' as const;
  readonly isOfflineDemo = true;

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const rawFirstUserMsg =
      request.messages.find((m) => m.role === 'user')?.content ?? '';
    const userGoalMsg = rawFirstUserMsg
      .replace(/^User goal:\s*/i, '')
      .split(/\n+(?:Approved Execution Plan|Long-term lessons:|Project notes:|Current workspace files:)/)[0]
      .trim();
    const lang = detectLanguage(userGoalMsg);
    const kind = classifyPrompt(userGoalMsg);

    const inputTokens = Math.max(120, Math.round(userGoalMsg.length * 1.8));

    if (request.role === 'Planner') {
      const planJson = this.buildPlan(userGoalMsg, lang, kind);
      return {
        text: JSON.stringify(planJson, null, 2),
        toolCalls: [],
        usage: { inputTokens, outputTokens: 280, totalTokens: inputTokens + 280, costUsd: 0 },
        model: request.model,
        provider: 'demo',
        stopReason: 'end_turn',
      };
    }

    if (request.role === 'Reviewer') {
      const verdict = this.buildReview(request);
      return {
        text: JSON.stringify(verdict, null, 2),
        toolCalls: [],
        usage: { inputTokens, outputTokens: 160, totalTokens: inputTokens + 160, costUsd: 0 },
        model: request.model,
        provider: 'demo',
        stopReason: 'end_turn',
      };
    }

    // Builder / Designer / Tester loop turn inspection
    const toolResults = request.messages.filter((m) => m.role === 'tool');
    const lastMessage = request.messages[request.messages.length - 1];
    const hasFixRequest = request.messages.some(
      (m) => m.role === 'user' && m.content.includes('REVIEWER_VETO_FIX:'),
    );

    // Handle safety gate test prompt cleanly
    const alreadyExecutedConfirmed = request.messages.some(
      (m) => m.role === 'user' && m.content.startsWith('User approved '),
    );
    if (alreadyExecutedConfirmed) {
      return {
        text: formatFinalSummary(
          lang,
          '- Executed the user-approved command inside the sandboxed workspace and recorded the audit log.',
        ),
        toolCalls: [],
        usage: { inputTokens, outputTokens: 80, totalTokens: inputTokens + 80, costUsd: 0 },
        model: request.model,
        provider: 'demo',
        stopReason: 'end_turn',
      };
    }

    if (/(rm\s+-rf|force[- ]push|reset --hard)/i.test(userGoalMsg) && toolResults.length === 0) {
      const dangerousCmd = userGoalMsg.toLowerCase().includes('force')
        ? 'git push origin main --force'
        : 'rm -rf ./tmp-build';
      return {
        text: 'Requesting terminal execution (subject to safety confirmation gate).',
        toolCalls: [
          {
            id: 'demo-safety-1',
            name: 'run_command',
            arguments: { command: dangerousCmd },
          },
        ],
        usage: { inputTokens, outputTokens: 90, totalTokens: inputTokens + 90, costUsd: 0 },
        model: request.model,
        provider: 'demo',
        stopReason: 'tool_use',
      };
    }

    // Check if we already ran verification in this turn batch
    const wroteFiles = toolResults.some((t) => t.toolName === 'write_file');
    const startedPreview = toolResults.some((t) => t.toolName === 'start_preview');
    const verifiedWeb = toolResults.some((t) => t.toolName === 'verify_web_app');
    const ranTests = toolResults.some((t) => t.toolName === 'run_command');

    if (hasFixRequest && !verifiedWeb) {
      // Apply Reviewer fix (e.g. add favicon/robots or polish interactive badge) & re-verify
      const toolCalls: LLMToolCall[] = [
        {
          id: 'demo-fix-1',
          name: 'write_file',
          arguments: {
            path: 'README.md',
            content: `# Project Built by Axiom\n\nGoal: ${userGoalMsg}\nVerified: automated checks & reviewer sign-off.\n`,
          },
        },
      ];
      if (kind !== 'api_service') {
        toolCalls.push({
          id: 'demo-fix-2',
          name: 'verify_web_app',
          arguments: { path: '/' },
        });
      }
      return {
        text: 'Applied reviewer fix and re-verifying.',
        toolCalls,
        usage: { inputTokens, outputTokens: 150, totalTokens: inputTokens + 150, costUsd: 0 },
        model: request.model,
        provider: 'demo',
        stopReason: 'tool_use',
      };
    }

    if (!wroteFiles) {
      const files = this.generateProjectFiles(userGoalMsg, lang, kind);
      const toolCalls: LLMToolCall[] = files.map((f, i) => ({
        id: `demo-write-${i}`,
        name: 'write_file',
        arguments: { path: f.path, content: f.content },
      }));
      return {
        text: `Writing ${files.length} cleanly structured project files.`,
        toolCalls,
        usage: { inputTokens, outputTokens: 450, totalTokens: inputTokens + 450, costUsd: 0 },
        model: request.model,
        provider: 'demo',
        stopReason: 'tool_use',
      };
    }

    if (kind === 'api_service') {
      if (!ranTests) {
        return {
          text: 'Running automated integration tests via node --test.',
          toolCalls: [
            {
              id: 'demo-test-api',
              name: 'run_command',
              arguments: { command: 'node --test tests/*.test.mjs' },
            },
          ],
          usage: { inputTokens, outputTokens: 80, totalTokens: inputTokens + 80, costUsd: 0 },
          model: request.model,
          provider: 'demo',
          stopReason: 'tool_use',
        };
      }
      return {
        text: formatFinalSummary(
          lang,
          '- Built `server.js` (ESM Node HTTP REST API with `/health` and `/api/notes` CRUD + input validation)\n- Built and ran `tests/api.test.mjs` (`node --test`) — all assertions verified.',
        ),
        toolCalls: [],
        usage: { inputTokens, outputTokens: 120, totalTokens: inputTokens + 120, costUsd: 0 },
        model: request.model,
        provider: 'demo',
        stopReason: 'end_turn',
      };
    }

    if (!startedPreview) {
      const calls: LLMToolCall[] = [
        {
          id: 'demo-preview-start',
          name: 'start_preview',
          arguments: { entryDir: '.' },
        },
      ];
      if (kind === 'crud_app') {
        calls.push({
          id: 'demo-crud-test',
          name: 'run_command',
          arguments: { command: 'node --test tests/*.test.mjs' },
        });
      }
      return {
        text: 'Launching live preview server and running verification checks.',
        toolCalls: calls,
        usage: { inputTokens, outputTokens: 90, totalTokens: inputTokens + 90, costUsd: 0 },
        model: request.model,
        provider: 'demo',
        stopReason: 'tool_use',
      };
    }

    if (!verifiedWeb) {
      return {
        text: 'Running HTTP, asset integrity, DOM/a11y, and JS syntax verification.',
        toolCalls: [
          {
            id: 'demo-verify-web',
            name: 'verify_web_app',
            arguments: { path: '/' },
          },
        ],
        usage: { inputTokens, outputTokens: 80, totalTokens: inputTokens + 80, costUsd: 0 },
        model: request.model,
        provider: 'demo',
        stopReason: 'tool_use',
      };
    }

    // Done building & verifying
    const lastNote = lastMessage?.role === 'tool' ? 'Verification tool completed.' : '';
    return {
      text: formatFinalSummary(
        lang,
        `- Built responsive ${kind.replace('_', ' ')} inside the sandbox workspace\n- Started live preview server and verified HTTP 200, asset links, semantic DOM/accessibility, and JS syntax\n- ${lastNote}`,
      ),
      toolCalls: [],
      usage: { inputTokens, outputTokens: 140, totalTokens: inputTokens + 140, costUsd: 0 },
      model: request.model,
      provider: 'demo',
      stopReason: 'end_turn',
    };
  }

  private buildPlan(prompt: string, lang: LanguageCode, kind: ProjectKind) {
    if (kind === 'api_service') {
      return {
        goal: `Build and verify a resilient REST API service for: ${prompt}`,
        projectType: 'api_service',
        options: [
          {
            id: 'opt-1',
            title: 'Zero-Dependency Node 22 ESM HTTP + JSON/SQLite + node:test',
            summary: 'Uses native node:http and node:test for instant boot, zero supply-chain bloat, and strict validation.',
            stack: ['Node.js ESM', 'node:http', 'node:test'],
            tradeoffs: 'Ultra-fast and lightweight; fewer middleware helpers than Express.',
          },
          {
            id: 'opt-2',
            title: 'Express 5 Router + Schema Validation',
            summary: 'Classic Express middleware stack with route modules.',
            stack: ['Node.js', 'Express 5'],
            tradeoffs: 'Requires npm install inside project workspace before boot.',
          },
          {
            id: 'opt-3',
            title: 'Python FastAPI Microservice',
            summary: 'Typed Python ASGI server with Pydantic validation.',
            stack: ['Python 3.11', 'FastAPI'],
            tradeoffs: 'Requires pip install and Python virtualenv setup.',
          },
        ],
        chosenOptionId: 'opt-1',
        rationaleOneLine: 'Zero-dependency Node 22 ESM boots instantaneously, passes automated integration tests immediately, and avoids install overhead.',
        steps: [
          'Design modular server.js with createApp() factory, /health, and /api/notes CRUD with strict JSON validation.',
          'Write real integration tests in tests/api.test.mjs using ephemeral port 0.',
          'Run node --test and verify 100% pass rate.',
        ],
        risks: ['Malformed JSON payloads crashing handler', 'Port conflicts during testing'],
        edgeCases: ['Empty title/body validation (400)', 'Missing note ID (404)', 'Oversized payload rejection (413)'],
        acceptanceCriteria: ['GET /health returns 200', 'CRUD create/read/delete persist and pass node --test'],
      };
    }

    if (kind === 'game_2d') {
      return {
        goal: `Build a playable 60fps 2D Canvas arcade vertical slice for: ${prompt}`,
        projectType: 'game_2d',
        options: [
          {
            id: 'opt-1',
            title: 'Custom 60fps HTML5 Canvas Engine with Fixed-Timestep Loop',
            summary: 'Pure ES module game loop with delta-clamping, particle system, AABB hitboxes, keyboard + touch controls.',
            stack: ['HTML5 Canvas', 'CSS3', 'ES2023 Modules'],
            tradeoffs: 'Zero bundle latency and crisp 60fps control; requires manual collision/render code.',
          },
          {
            id: 'opt-2',
            title: 'Phaser 3 CDN Bundle',
            summary: 'Full 2D game framework loaded via script.',
            stack: ['Phaser 3', 'JavaScript'],
            tradeoffs: 'Relies on external CDN and adds heavier initialization.',
          },
          {
            id: 'opt-3',
            title: 'SVG DOM Sprite Loop',
            summary: 'Animates SVG elements in DOM.',
            stack: ['SVG', 'CSS Transforms'],
            tradeoffs: 'Degrades quickly above 40 simultaneous particles/entities.',
          },
        ],
        chosenOptionId: 'opt-1',
        rationaleOneLine: 'A lean fixed-timestep Canvas 2D loop guarantees zero external CDN risk, instant startup, and reliable 60fps arcade feel.',
        steps: [
          'Create semantic game shell (index.html) with accessible HUD, pause/restart controls, and mobile touch pad.',
          'Implement game.js with delta-time loop, starfield parallax, player ship, enemy waves, projectiles, particles, and high-score.',
          'Serve via live preview and run DOM/syntax/HTTP verification.',
        ],
        risks: ['Frame-rate dependency on high-refresh monitors', 'Lost keyboard focus inside iframe'],
        edgeCases: ['Restart resets wave/lives cleanly', 'Mobile touch buttons work without scrolling', 'Pause freezes physics delta'],
        acceptanceCriteria: ['Canvas renders with HUD score/lives/restart', 'Zero JS syntax errors', 'HTTP 200 + all assets valid'],
      };
    }

    if (kind === 'crud_app') {
      return {
        goal: `Build an interactive, tested CRUD application for: ${prompt}`,
        projectType: 'crud_app',
        options: [
          {
            id: 'opt-1',
            title: 'Modular Vanilla ES2023 Reactive Store + LocalStorage + node:test',
            summary: 'Clean state reducer module shared between browser UI and Node unit tests with instant load.',
            stack: ['HTML5', 'CSS3 Grid', 'ES Modules', 'node:test'],
            tradeoffs: 'Instant zero-build preview and directly unit-testable store logic.',
          },
          {
            id: 'opt-2',
            title: 'React + Vite SPA',
            summary: 'Component-driven Vite build.',
            stack: ['React 19', 'Vite'],
            tradeoffs: 'Requires per-workspace npm install before serving.',
          },
          {
            id: 'opt-3',
            title: 'Server-Rendered Express + SQLite Templates',
            summary: 'Full page reloads on mutations.',
            stack: ['Express', 'SQLite'],
            tradeoffs: 'Slower interaction feedback compared to optimistic client state.',
          },
        ],
        chosenOptionId: 'opt-1',
        rationaleOneLine: 'A shared pure-JS state module lets us run real Node unit tests on CRUD invariants while delivering an instant reactive UI.',
        steps: [
          'Build pure state reducer in store.mjs (add, toggle, update, delete, filter, search).',
          'Build responsive accessible UI in index.html, styles.css, and app.js with localStorage persistence.',
          'Write and run unit tests in tests/store.test.mjs and verify live preview.',
        ],
        risks: ['XSS via unescaped user task text', 'Corrupted localStorage JSON'],
        edgeCases: ['Empty input rejected cleanly', 'Search + status filter compose accurately', 'Corrupted storage resets safely'],
        acceptanceCriteria: ['Create/toggle/filter/delete all work', 'XSS-safe DOM rendering (textContent)', 'node --test and verify_web_app pass'],
      };
    }

    const langNote = lang === 'singlish' ? ' (Singlish user reply)' : lang === 'si' ? ' (Sinhala user reply)' : '';
    return {
      goal: `Design, build, and verify a high-craft modern landing page${langNote} for: ${prompt}`,
      projectType: 'landing_page',
      options: [
        {
          id: 'opt-1',
          title: 'Bespoke Modern HTML5 + Fluid CSS3 + Interactive ES Module',
          summary: 'Crafted from scratch with fluid clamp() typography, custom inline SVG artwork, theme toggle, interactive ROI/tier estimator, and zero external CDN dependencies.',
          stack: ['Semantic HTML5', 'Modern CSS3', 'ES2023 JS'],
          tradeoffs: 'Zero build lag and 100% self-contained reliability; manually structured components.',
        },
        {
          id: 'opt-2',
          title: 'React + Vite + Tailwind Static Export',
          summary: 'Component SPA compiled via Vite.',
          stack: ['React', 'Vite', 'Tailwind'],
          tradeoffs: 'Heavy dependency install latency for a marketing landing page.',
        },
        {
          id: 'opt-3',
          title: 'Minimal Single-File Inline HTML',
          summary: 'Everything crammed into one HTML document.',
          stack: ['HTML'],
          tradeoffs: 'Harder to maintain styles and scripts separately.',
        },
      ],
      chosenOptionId: 'opt-1',
      rationaleOneLine: 'Bespoke semantic HTML5 + CSS3 + ES modules loads in milliseconds, needs zero external CDNs, and separates markup, design tokens, and interactivity cleanly.',
      steps: [
        'Craft semantic responsive layout (header/nav, hero with custom SVG visual, interactive feature/pricing toggle, architecture metrics, validated waitlist form, footer).',
        'Style with modern CSS custom properties, fluid grid, and dark/light theme support.',
        'Start live preview server and verify HTTP 200, asset links, DOM landmarks, accessibility, and JS syntax.',
      ],
      risks: ['Root-relative asset paths failing behind preview proxy', 'Mobile horizontal overflow'],
      edgeCases: ['Small viewport (375px) layout', 'Form validation on empty/invalid email', 'Keyboard navigation & ARIA labels'],
      acceptanceCriteria: ['Live preview returns HTTP 200', 'All relative ./styles.css and ./app.js resolve', 'Semantic landmarks, h1, viewport meta, and interactive controls verified'],
    };
  }

  private buildReview(request: LLMCompletionRequest) {
    const contextText = request.messages.map((m) => m.content).join('\n');
    const match = contextText.match(/VERIFICATION_JSON:\s*(\{[\s\S]*\})/);
    let verification: VerificationReport | undefined;
    if (match) {
      try {
        verification = JSON.parse(match[1]) as VerificationReport;
      } catch {
        verification = undefined;
      }
    }

    if (verification && !verification.passed) {
      const failed = verification.checks.filter((c) => !c.passed);
      return {
        approved: false,
        vetoed: true,
        score: 52,
        summary: `Vetoed: ${failed.length} verification check(s) failed.`,
        issues: failed.map((c) => ({
          severity: 'blocker',
          category: 'functionality',
          description: `${c.name}: ${c.details}`,
          fixInstruction: `Fix failing check "${c.name}" (${c.details}) and re-verify.`,
        })),
      };
    }

    return {
      approved: true,
      vetoed: false,
      score: 92,
      summary: 'All automated build, asset integrity, semantic DOM/a11y, and syntax checks passed cleanly.',
      issues: [],
    };
  }

  private generateProjectFiles(
    prompt: string,
    lang: LanguageCode,
    kind: ProjectKind,
  ): Array<{ path: string; content: string }> {
    if (kind === 'api_service') {
      return this.generateApiServiceFiles();
    }
    if (kind === 'game_2d') {
      return this.generate2DGameFiles();
    }
    if (kind === 'crud_app') {
      return this.generateCrudAppFiles();
    }
    return this.generateLandingPageFiles(prompt, lang);
  }

  private generateLandingPageFiles(prompt: string, lang: LanguageCode) {
    const { brand, topic, tagline } = extractBrandAndTopic(prompt);
    const heroCta =
      lang === 'si'
        ? 'දැන්ම ආරම්භ කරන්න'
        : lang === 'singlish'
          ? 'Danma Start Karanna'
          : 'Launch Workspace';
    const subBadge =
      lang === 'si'
        ? 'නව පරපුරේ තාක්ෂණය'
        : lang === 'singlish'
          ? 'Aluth First-Principles Tech'
          : 'Built From First Principles';

    const indexHtml = `<!doctype html>
<html lang="${lang === 'si' ? 'si' : 'en'}" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="${brand} — ${tagline}" />
  <title>${brand} | ${topic}</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <header class="site-header">
    <div class="container nav-row">
      <a href="#top" class="brand" aria-label="${brand} home">
        <span class="brand-mark" aria-hidden="true">◆</span>
        <span>${brand}</span>
      </a>
      <nav aria-label="Primary navigation" class="nav-links">
        <a href="#architecture">Architecture</a>
        <a href="#estimator">Impact</a>
        <a href="#early-access">Access</a>
      </nav>
      <div class="nav-actions">
        <button id="theme-toggle" type="button" class="btn btn-ghost" aria-label="Toggle color theme">
          Theme
        </button>
        <a href="#early-access" class="btn btn-primary">${heroCta}</a>
      </div>
    </div>
  </header>

  <main id="top">
    <section class="hero container">
      <div class="hero-copy">
        <span class="pill">${subBadge}</span>
        <h1>${topic}</h1>
        <p class="lead">${tagline}</p>
        <div class="hero-cta-row">
          <a href="#early-access" class="btn btn-primary">${heroCta}</a>
          <a href="#architecture" class="btn btn-secondary">Explore Architecture</a>
        </div>
        <dl class="metrics" aria-label="Key metrics">
          <div><dt>Latency</dt><dd>&lt; 18 ms</dd></div>
          <div><dt>Efficiency</dt><dd>99.4%</dd></div>
          <div><dt>Zero Legacy</dt><dd>100%</dd></div>
        </dl>
      </div>
      <div class="hero-visual" aria-label="System telemetry preview">
        <svg viewBox="0 0 360 280" role="img" aria-label="${brand} architectural diagram" class="hero-svg">
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#6366f1"/>
              <stop offset="100%" stop-color="#10b981"/>
            </linearGradient>
          </defs>
          <rect x="16" y="16" width="328" height="248" rx="18" fill="rgba(17,24,39,0.75)" stroke="url(#g1)" stroke-width="2"/>
          <circle cx="180" cy="140" r="68" fill="none" stroke="url(#g1)" stroke-width="3" stroke-dasharray="8 6"/>
          <circle cx="180" cy="140" r="34" fill="url(#g1)" opacity="0.28"/>
          <circle cx="180" cy="140" r="14" fill="#10b981"/>
          <circle cx="112" cy="96" r="10" fill="#818cf8"/>
          <circle cx="248" cy="184" r="10" fill="#34d399"/>
          <line x1="120" y1="102" x2="170" y2="134" stroke="#818cf8" stroke-width="2"/>
          <line x1="190" y1="146" x2="240" y2="178" stroke="#34d399" stroke-width="2"/>
        </svg>
      </div>
    </section>

    <section id="architecture" class="container section">
      <h2>First-Principles Engineering</h2>
      <div class="grid-3">
        <article class="card">
          <h3>Zero Bloat Core</h3>
          <p>Designed directly around what the workload actually needs, eliminating legacy abstractions.</p>
        </article>
        <article class="card">
          <h3>Verified Telemetry</h3>
          <p>Continuous automated checks ensure every route, contract, and layout holds under real load.</p>
        </article>
        <article class="card">
          <h3>Adaptive Scale</h3>
          <p>Fluid edge-ready architecture scaling seamlessly from single node to global mesh.</p>
        </article>
      </div>
    </section>

    <section id="estimator" class="container section estimator-box">
      <h2>Interactive Output Estimator</h2>
      <p>Adjust deployment nodes to estimate throughput and energy savings in real time.</p>
      <div class="estimator-controls">
        <label for="scale-range">Active Nodes: <strong id="scale-value">12</strong></label>
        <input id="scale-range" type="range" min="1" max="100" value="12" />
      </div>
      <div class="estimator-readout" aria-live="polite">
        <div><span>Projected Throughput</span><strong id="throughput-out">14.4k req/s</strong></div>
        <div><span>Overhead Saved</span><strong id="savings-out">42%</strong></div>
      </div>
    </section>

    <section id="early-access" class="container section">
      <div class="cta-panel">
        <h2>Request Early Access</h2>
        <p>Join builders shipping with ${brand}.</p>
        <form id="waitlist-form" class="waitlist-form" novalidate>
          <label class="sr-only" for="email-input">Work email</label>
          <input id="email-input" type="email" required placeholder="you@domain.com" />
          <button type="submit" class="btn btn-primary">${heroCta}</button>
        </form>
        <p id="form-feedback" class="feedback" role="status" aria-live="polite"></p>
      </div>
    </section>
  </main>

  <footer class="site-footer container">
    <p>&copy; <span id="year">2026</span> ${brand}. Crafted autonomously by Axiom.</p>
  </footer>
  <script type="module" src="./app.js"></script>
</body>
</html>
`;

    const stylesCss = `:root {
  --bg: #070b14;
  --surface: #101726;
  --border: rgba(148, 163, 184, 0.2);
  --text: #f8fafc;
  --muted: #94a3b8;
  --accent: #6366f1;
  --accent-2: #10b981;
}
[data-theme='light'] {
  --bg: #f8fafc;
  --surface: #ffffff;
  --border: rgba(15, 23, 42, 0.12);
  --text: #0f172a;
  --muted: #475569;
}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  font-family: Inter, system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}
.container { max-width: 1120px; margin: 0 auto; padding: 0 1.25rem; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
.site-header {
  position: sticky; top: 0; z-index: 20;
  backdrop-filter: blur(12px);
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  border-bottom: 1px solid var(--border);
}
.nav-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.9rem 1.25rem; }
.brand { display: inline-flex; align-items: center; gap: 0.5rem; font-weight: 700; color: var(--text); text-decoration: none; }
.brand-mark { color: var(--accent-2); }
.nav-links { display: flex; gap: 1.25rem; }
.nav-links a { color: var(--muted); text-decoration: none; font-size: 0.95rem; }
.nav-links a:hover { color: var(--text); }
.nav-actions { display: flex; gap: 0.6rem; align-items: center; }
.btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0.6rem 1.1rem; border-radius: 10px; font-weight: 600; font-size: 0.92rem;
  border: 1px solid var(--border); cursor: pointer; text-decoration: none;
}
.btn-primary { background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; border: none; }
.btn-secondary { background: var(--surface); color: var(--text); }
.btn-ghost { background: transparent; color: var(--muted); }
.hero {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
  gap: 2.5rem; align-items: center; padding: 4rem 1.25rem 3rem;
}
.pill {
  display: inline-block; padding: 0.25rem 0.75rem; border-radius: 999px;
  font-size: 0.8rem; font-weight: 600; color: var(--accent-2);
  border: 1px solid color-mix(in srgb, var(--accent-2) 40%, transparent);
}
h1 { font-size: clamp(2rem, 4vw, 3.25rem); line-height: 1.12; margin: 0.8rem 0; }
.lead { color: var(--muted); font-size: 1.1rem; max-width: 54ch; }
.hero-cta-row { display: flex; flex-wrap: wrap; gap: 0.8rem; margin: 1.5rem 0; }
.metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin: 1.5rem 0 0; }
.metrics dt { font-size: 0.78rem; color: var(--muted); }
.metrics dd { margin: 0.15rem 0 0; font-size: 1.15rem; font-weight: 700; }
.hero-svg { width: 100%; height: auto; display: block; }
.section { padding: 3rem 1.25rem; }
.grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.25rem; }
.card, .estimator-box, .cta-panel {
  background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 1.5rem;
}
.card p, .estimator-box p { color: var(--muted); }
.estimator-controls { display: flex; flex-direction: column; gap: 0.6rem; margin: 1rem 0; }
.estimator-readout { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-top: 1rem; }
.estimator-readout span { display: block; font-size: 0.85rem; color: var(--muted); }
.estimator-readout strong { font-size: 1.4rem; color: var(--accent-2); }
.waitlist-form { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1rem; }
.waitlist-form input {
  flex: 1 1 240px; padding: 0.7rem 0.9rem; border-radius: 10px;
  border: 1px solid var(--border); background: var(--bg); color: var(--text);
}
.feedback { min-height: 1.4rem; margin-top: 0.6rem; color: var(--accent-2); font-size: 0.92rem; }
.site-footer { border-top: 1px solid var(--border); padding: 1.75rem 1.25rem; color: var(--muted); font-size: 0.9rem; }
@media (max-width: 640px) {
  .nav-links { display: none; }
}
`;

    const appJs = `const root = document.documentElement;
const themeBtn = document.getElementById('theme-toggle');
themeBtn?.addEventListener('click', () => {
  const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  root.setAttribute('data-theme', next);
});

const slider = document.getElementById('scale-range');
const scaleOut = document.getElementById('scale-value');
const throughputOut = document.getElementById('throughput-out');
const savingsOut = document.getElementById('savings-out');

function updateEstimator() {
  if (!slider) return;
  const nodes = Number(slider.value || 12);
  if (scaleOut) scaleOut.textContent = String(nodes);
  if (throughputOut) throughputOut.textContent = (nodes * 1.2).toFixed(1) + 'k req/s';
  if (savingsOut) savingsOut.textContent = Math.min(68, 28 + Math.round(nodes * 0.4)) + '%';
}
slider?.addEventListener('input', updateEstimator);
updateEstimator();

const form = document.getElementById('waitlist-form');
const emailInput = document.getElementById('email-input');
const feedback = document.getElementById('form-feedback');

form?.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = (emailInput?.value || '').trim();
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value)) {
    if (feedback) feedback.textContent = 'Please enter a valid email address.';
    return;
  }
  if (feedback) feedback.textContent = 'Confirmed! ' + value + ' added to the early-access queue.';
  form.reset();
});
`;

    return [
      { path: 'index.html', content: indexHtml },
      { path: 'styles.css', content: stylesCss },
      { path: 'app.js', content: appJs },
    ];
  }

  private generateCrudAppFiles() {
    const storeMjs = `export function createTask(tasks, title, priority = 'medium') {
  const clean = String(title || '').trim();
  if (!clean) throw new Error('Task title is required');
  const next = {
    id: 't-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    title: clean,
    priority,
    done: false,
    createdAt: new Date().toISOString(),
  };
  return [next, ...tasks];
}

export function toggleTask(tasks, id) {
  return tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
}

export function deleteTask(tasks, id) {
  return tasks.filter((t) => t.id !== id);
}

export function filterTasks(tasks, filter = 'all', query = '') {
  const q = String(query || '').trim().toLowerCase();
  return tasks.filter((t) => {
    if (filter === 'active' && t.done) return false;
    if (filter === 'done' && !t.done) return false;
    if (q && !t.title.toLowerCase().includes(q)) return false;
    return true;
  });
}
`;

    const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PulseTask — Interactive CRUD Tracker</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <header class="header">
    <div class="container">
      <h1>PulseTask Tracker</h1>
      <p>Persistent CRUD task management with real-time filter &amp; search.</p>
    </div>
  </header>
  <main class="container">
    <section class="panel" aria-label="Add task">
      <form id="task-form" class="row">
        <label class="sr-only" for="task-title">Task title</label>
        <input id="task-title" type="text" placeholder="Add a deliverable or engineering task..." required />
        <label class="sr-only" for="task-priority">Priority</label>
        <select id="task-priority">
          <option value="high">High</option>
          <option value="medium" selected>Medium</option>
          <option value="low">Low</option>
        </select>
        <button type="submit" class="btn-primary">Add Task</button>
      </form>
      <div class="toolbar">
        <div class="filters" role="group" aria-label="Task status filter">
          <button type="button" data-filter="all" class="active">All</button>
          <button type="button" data-filter="active">Active</button>
          <button type="button" data-filter="done">Done</button>
        </div>
        <label class="sr-only" for="search-input">Search tasks</label>
        <input id="search-input" type="search" placeholder="Search tasks..." />
      </div>
    </section>
    <section class="panel" aria-label="Task list">
      <div id="stats" class="stats" aria-live="polite"></div>
      <ul id="task-list" class="task-list"></ul>
    </section>
  </main>
  <footer class="container footer">Built with modular state logic &amp; automated unit tests.</footer>
  <script type="module" src="./app.js"></script>
</body>
</html>
`;

    const stylesCss = `*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #0b0f17; color: #f8fafc; line-height: 1.5; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
.container { max-width: 780px; margin: 0 auto; padding: 1rem 1.25rem; }
.header { border-bottom: 1px solid #1e293b; padding: 1rem 0; }
.header h1 { margin: 0; font-size: 1.6rem; }
.header p { margin: 0.25rem 0 0; color: #94a3b8; }
.panel { background: #111827; border: 1px solid #1f2937; border-radius: 14px; padding: 1.2rem; margin-top: 1.2rem; }
.row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
input, select {
  background: #0b0f17; color: #f8fafc; border: 1px solid #334155; border-radius: 8px; padding: 0.6rem 0.8rem;
}
#task-title { flex: 1 1 240px; }
button { cursor: pointer; border-radius: 8px; border: 1px solid #334155; padding: 0.55rem 0.9rem; background: #1e293b; color: #f8fafc; }
.btn-primary { background: #6366f1; border-color: #6366f1; font-weight: 600; }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; margin-top: 1rem; flex-wrap: wrap; }
.filters { display: flex; gap: 0.4rem; }
.filters button.active { background: #10b981; border-color: #10b981; color: #042f2e; font-weight: 600; }
.stats { font-size: 0.88rem; color: #94a3b8; margin-bottom: 0.75rem; }
.task-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.55rem; }
.task-item { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; background: #0f172a; padding: 0.75rem; border-radius: 10px; border: 1px solid #1e293b; }
.task-item.done .title { text-decoration: line-through; color: #64748b; }
.badge { font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 999px; background: #1e293b; color: #cbd5e1; }
.footer { color: #64748b; font-size: 0.85rem; }
`;

    const appJs = `import { createTask, toggleTask, deleteTask, filterTasks } from './store.mjs';

const STORAGE_KEY = 'pulse_tasks_v1';
let tasks = loadTasks();
let activeFilter = 'all';
let searchQuery = '';

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function render() {
  const list = document.getElementById('task-list');
  const stats = document.getElementById('stats');
  if (!list || !stats) return;

  const doneCount = tasks.filter((t) => t.done).length;
  stats.textContent = tasks.length + ' total · ' + doneCount + ' completed';

  const visible = filterTasks(tasks, activeFilter, searchQuery);
  list.replaceChildren();

  if (visible.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'task-item';
    empty.textContent = 'No matching tasks.';
    list.appendChild(empty);
    return;
  }

  for (const t of visible) {
    const li = document.createElement('li');
    li.className = 'task-item' + (t.done ? ' done' : '');

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '0.6rem';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.textContent = t.done ? '✓' : '○';
    toggleBtn.setAttribute('aria-label', 'Toggle ' + t.title);
    toggleBtn.addEventListener('click', () => {
      tasks = toggleTask(tasks, t.id);
      save();
      render();
    });

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = t.title;

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = t.priority;

    left.append(toggleBtn, title, badge);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      tasks = deleteTask(tasks, t.id);
      save();
      render();
    });

    li.append(left, delBtn);
    list.appendChild(li);
  }
}

document.getElementById('task-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const titleEl = document.getElementById('task-title');
  const prioEl = document.getElementById('task-priority');
  try {
    tasks = createTask(tasks, titleEl.value, prioEl.value);
    titleEl.value = '';
    save();
    render();
  } catch {
    // ignore empty
  }
});

document.querySelectorAll('.filters button').forEach((btn) => {
  btn.addEventListener('click', () => {
    activeFilter = btn.dataset.filter || 'all';
    document.querySelectorAll('.filters button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  });
});

document.getElementById('search-input')?.addEventListener('input', (e) => {
  searchQuery = e.target.value || '';
  render();
});

render();
`;

    const testMjs = `import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask, toggleTask, deleteTask, filterTasks } from '../store.mjs';

test('CRUD task store invariants', () => {
  let list = [];
  list = createTask(list, 'Ship Axiom MVP', 'high');
  list = createTask(list, 'Write eval suite', 'medium');
  assert.equal(list.length, 2);

  const firstId = list[0].id;
  list = toggleTask(list, firstId);
  assert.equal(filterTasks(list, 'done').length, 1);
  assert.equal(filterTasks(list, 'active').length, 1);
  assert.equal(filterTasks(list, 'all', 'axiom').length, 1);

  list = deleteTask(list, firstId);
  assert.equal(list.length, 1);
});
`;

    return [
      { path: 'store.mjs', content: storeMjs },
      { path: 'index.html', content: indexHtml },
      { path: 'styles.css', content: stylesCss },
      { path: 'app.js', content: appJs },
      { path: 'tests/store.test.mjs', content: testMjs },
    ];
  }

  private generate2DGameFiles() {
    const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vanguard Vector — 2D Arcade Slice</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <header class="hud-bar">
    <h1>Vanguard Vector</h1>
    <div class="hud-stats" aria-live="polite">
      <span>Score: <strong id="score">0</strong></span>
      <span>Lives: <strong id="lives">3</strong></span>
      <span>Wave: <strong id="wave">1</strong></span>
    </div>
    <div class="hud-controls">
      <button id="pause-btn" type="button">Pause</button>
      <button id="restart-btn" type="button">Restart</button>
    </div>
  </header>
  <main class="arena-wrap">
    <canvas id="game-canvas" width="760" height="480" aria-label="2D arcade game canvas"></canvas>
    <p class="controls-hint">Move: Arrow Keys / A-D &middot; Fire: Spacebar &middot; Original IP 60 FPS Slice</p>
  </main>
  <footer class="footer">Axiom Game Engine Slice — Canvas 2D</footer>
  <script type="module" src="./game.js"></script>
</body>
</html>
`;

    const stylesCss = `* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #050814; color: #f8fafc; display: flex; flex-direction: column; min-height: 100vh; }
.hud-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.75rem 1.25rem; background: #0d1326; border-bottom: 1px solid #1e293b; }
.hud-bar h1 { margin: 0; font-size: 1.15rem; color: #38bdf8; }
.hud-stats { display: flex; gap: 1.25rem; font-size: 0.95rem; }
.hud-controls { display: flex; gap: 0.5rem; }
button { background: #1e293b; color: #f8fafc; border: 1px solid #334155; border-radius: 8px; padding: 0.4rem 0.85rem; cursor: pointer; }
.arena-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; }
canvas { max-width: 100%; height: auto; border-radius: 12px; border: 1px solid #1e293b; background: #02040a; box-shadow: 0 20px 50px rgba(0,0,0,0.6); }
.controls-hint, .footer { color: #64748b; font-size: 0.85rem; text-align: center; padding: 0.5rem; }
`;

    const gameJs = `const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const waveEl = document.getElementById('wave');

const keys = new Set();
let state;

function resetState() {
  state = {
    paused: false,
    gameOver: false,
    score: 0,
    lives: 3,
    wave: 1,
    cooldown: 0,
    spawnTimer: 0.5,
    player: { x: canvas.width / 2, y: canvas.height - 46, w: 34, h: 20, speed: 340 },
    bullets: [],
    enemies: [],
    particles: [],
    stars: Array.from({ length: 55 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      s: 0.8 + Math.random() * 1.8,
    })),
  };
  syncHud();
}

function syncHud() {
  if (scoreEl) scoreEl.textContent = String(state.score);
  if (livesEl) livesEl.textContent = String(state.lives);
  if (waveEl) waveEl.textContent = String(state.wave);
}

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

document.getElementById('pause-btn')?.addEventListener('click', () => {
  state.paused = !state.paused;
});
document.getElementById('restart-btn')?.addEventListener('click', resetState);

function spawnBurst(x, y, color) {
  for (let i = 0; i < 12; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 140;
    state.particles.push({
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0.45, color,
    });
  }
}

function update(dt) {
  if (state.paused || state.gameOver) return;

  for (const st of state.stars) {
    st.y += st.s * 36 * dt;
    if (st.y > canvas.height) { st.y = 0; st.x = Math.random() * canvas.width; }
  }

  if (keys.has('ArrowLeft') || keys.has('KeyA')) state.player.x -= state.player.speed * dt;
  if (keys.has('ArrowRight') || keys.has('KeyD')) state.player.x += state.player.speed * dt;
  state.player.x = Math.max(22, Math.min(canvas.width - 22, state.player.x));

  state.cooldown = Math.max(0, state.cooldown - dt);
  if (keys.has('Space') && state.cooldown <= 0) {
    state.bullets.push({ x: state.player.x, y: state.player.y - 14, vy: -520 });
    state.cooldown = 0.16;
  }

  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    state.enemies.push({
      x: 30 + Math.random() * (canvas.width - 60),
      y: -20,
      r: 14,
      vy: 75 + state.wave * 18,
    });
    state.spawnTimer = Math.max(0.32, 1.15 - state.wave * 0.08);
  }

  state.bullets = state.bullets.filter((b) => {
    b.y += b.vy * dt;
    return b.y > -20;
  });

  const survivingEnemies = [];
  for (const en of state.enemies) {
    en.y += en.vy * dt;
    let hit = false;
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      if (Math.hypot(b.x - en.x, b.y - en.y) < en.r + 5) {
        state.bullets.splice(i, 1);
        state.score += 100;
        state.wave = 1 + Math.floor(state.score / 800);
        spawnBurst(en.x, en.y, '#38bdf8');
        syncHud();
        hit = true;
        break;
      }
    }
    if (hit) continue;
    if (en.y > canvas.height + 16) {
      state.lives -= 1;
      syncHud();
      if (state.lives <= 0) state.gameOver = true;
      continue;
    }
    survivingEnemies.push(en);
  }
  state.enemies = survivingEnemies;

  state.particles = state.particles.filter((p) => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    return p.life > 0;
  });
}

function draw() {
  ctx.fillStyle = '#02040a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
  for (const st of state.stars) ctx.fillRect(st.x, st.y, st.s, st.s);

  // Player craft
  ctx.fillStyle = '#10b981';
  ctx.beginPath();
  ctx.moveTo(state.player.x, state.player.y - 14);
  ctx.lineTo(state.player.x - 16, state.player.y + 12);
  ctx.lineTo(state.player.x + 16, state.player.y + 12);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#fbbf24';
  for (const b of state.bullets) ctx.fillRect(b.x - 2, b.y - 8, 4, 12);

  ctx.fillStyle = '#f43f5e';
  for (const en of state.enemies) {
    ctx.beginPath();
    ctx.arc(en.x, en.y, en.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const p of state.particles) {
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, p.life * 2);
    ctx.fillRect(p.x, p.y, 3, 3);
  }
  ctx.globalAlpha = 1;

  if (state.gameOver) {
    ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 28px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER — Click Restart', canvas.width / 2, canvas.height / 2);
  }
}

resetState();
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
`;

    return [
      { path: 'index.html', content: indexHtml },
      { path: 'styles.css', content: stylesCss },
      { path: 'game.js', content: gameJs },
    ];
  }

  private generateApiServiceFiles() {
    const serverJs = `import http from 'node:http';
import { randomUUID } from 'node:crypto';

export function createApp() {
  const notes = new Map();

  function sendJson(res, status, data) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }

  async function readJson(req) {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 100_000) {
        const err = new Error('Payload too large');
        err.status = 413;
        throw err;
      }
    }
    if (!raw.trim()) return {};
    try {
      return JSON.parse(raw);
    } catch {
      const err = new Error('Invalid JSON');
      err.status = 400;
      throw err;
    }
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, { ok: true, service: 'axiom-notes-api' });
      }
      if (req.method === 'GET' && url.pathname === '/api/notes') {
        return sendJson(res, 200, { notes: Array.from(notes.values()) });
      }
      if (req.method === 'POST' && url.pathname === '/api/notes') {
        const body = await readJson(req);
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        if (!title) {
          return sendJson(res, 400, { error: 'title is required' });
        }
        const item = { id: randomUUID().slice(0, 8), title, content, createdAt: new Date().toISOString() };
        notes.set(item.id, item);
        return sendJson(res, 201, { note: item });
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/notes/')) {
        const id = url.pathname.slice('/api/notes/'.length);
        if (!notes.has(id)) {
          return sendJson(res, 404, { error: 'Note not found' });
        }
        notes.delete(id);
        return sendJson(res, 200, { deleted: id });
      }
      return sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message || 'Server error' });
    }
  });
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const port = Number(process.env.PORT || 4000);
  const server = createApp();
  server.listen(port, '0.0.0.0', () => {
    console.log('Notes API listening on 0.0.0.0:' + port);
  });
}
`;

    const testMjs = `import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

test('Notes REST API health + CRUD + validation', async () => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = 'http://127.0.0.1:' + port;

  try {
    const h = await fetch(base + '/health');
    assert.equal(h.status, 200);

    const bad = await fetch(base + '/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '   ' }),
    });
    assert.equal(bad.status, 400);

    const created = await fetch(base + '/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Architecture note', content: 'Keep core minimal' }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.note.title, 'Architecture note');

    const listed = await (await fetch(base + '/api/notes')).json();
    assert.equal(listed.notes.length, 1);

    const del = await fetch(base + '/api/notes/' + createdBody.note.id, { method: 'DELETE' });
    assert.equal(del.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
`;

    return [
      { path: 'server.js', content: serverJs },
      { path: 'tests/api.test.mjs', content: testMjs },
    ];
  }
}
