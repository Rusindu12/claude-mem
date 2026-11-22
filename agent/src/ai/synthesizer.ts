import type { ExecutionPlan } from '../shared/types.ts';
import type { ParsedPromptIntent } from './semantic-parser.ts';

export interface SynthesizedFile {
  path: string;
  content: string;
}

export function buildExecutionPlan(parsed: ParsedPromptIntent): ExecutionPlan {
  const pct = Math.round(parsed.confidence * 100);
  const metaNote = `[Axiom Neural Core: ${parsed.intent} (${pct}% conf) · domain=${parsed.domain}]`;
  const language = parsed.language;

  switch (parsed.intent) {
    case 'game_3d':
      return {
        language,
        goal: `${metaNote} Build a playable 3D open-world action vertical slice ("Aether District 07") for: ${parsed.rawPrompt}`,
        projectType: 'game_2d',
        options: [
          {
            id: 'opt-1',
            title: 'Three.js Local WebGL District Slice + Arcade Vehicle Physics + NPC Traffic',
            summary: 'Self-contained ES module 3D engine with procedural city blocks, 3 switchable vehicles, day/night toggle, minimap radar, and delivery mission.',
            stack: ['Three.js (Local Vendor)', 'HTML5 Canvas HUD/Minimap', 'ES2023 Modules'],
            tradeoffs: '60 FPS browser-native with zero external CDN reliance; procedural geometry instead of external GLTF packs.',
          },
          {
            id: 'opt-2',
            title: 'Godot 4 Forward+ Desktop Project',
            summary: 'Native GDScript 3D project files.',
            stack: ['Godot 4', 'GDScript'],
            tradeoffs: 'Cannot render live inside browser preview iframe without headless export.',
          },
          {
            id: 'opt-3',
            title: 'Raw WebGL2 Shader Engine',
            summary: 'Hand-rolled matrix math and GLSL shaders.',
            stack: ['WebGL2', 'GLSL'],
            tradeoffs: 'Higher complexity for lighting, shadows, and camera transforms.',
          },
        ],
        chosenOptionId: 'opt-1',
        rationaleOneLine: 'Local Three.js ES modules deliver an instant 60 FPS playable 3D district vertical slice directly inside Live Preview with zero CDN dependencies.',
        steps: [
          'Build accessible 3D HUD shell with vehicle switcher, day/night button, mission banner, and live radar minimap.',
          'Implement Three.js procedural city grid, 3 vehicles with physics, NPC traffic AI, and mission beacon loop.',
          'Provision local Three.js vendor modules, boot preview, and verify HTTP/DOM/syntax.',
        ],
        risks: ['Heavy draw calls dropping FPS on low-power CPUs', 'External CDN blocked in sandbox'],
        edgeCases: ['Vehicle out-of-bounds clamping', 'Mission timer completion/reset', 'Canvas resize responsiveness'],
        acceptanceCriteria: ['Three.js scene + HUD + minimap + 3 vehicles + NPC traffic + mission implemented', 'Zero JS syntax errors', 'HTTP 200 on index.html and vendor/three.module.js'],
      };

    case 'analytics_dashboard':
      return {
        language,
        goal: `${metaNote} Build an interactive ${parsed.brand} analytics dashboard with live SVG charts & CSV export`,
        projectType: 'crud_app',
        options: [
          {
            id: 'opt-1',
            title: 'Zero-CDN Reactive Telemetry Store + Pure SVG Charts + CSV Export',
            summary: 'Custom accessible SVG bar & donut charts driven by a modular ESM dataset reducer tested with node --test.',
            stack: ['HTML5', 'CSS3 Grid', 'SVG Visualization', 'ES2023 Modules', 'node:test'],
            tradeoffs: 'Instant load and crisp vector rendering at any zoom without bloated chart libraries.',
          },
          {
            id: 'opt-2',
            title: 'Canvas Chart.js CDN Bundle',
            summary: 'External chart library via CDN.',
            stack: ['Chart.js', 'HTML5'],
            tradeoffs: 'Fails offline and produces rasterized canvas charts.',
          },
          {
            id: 'opt-3',
            title: 'Static Server-Rendered HTML Table',
            summary: 'Plain numeric rows without visual charts.',
            stack: ['HTML'],
            tradeoffs: 'Poor trend visibility compared to interactive visualizations.',
          },
        ],
        chosenOptionId: 'opt-1',
        rationaleOneLine: 'Pure vector SVG charts paired with a unit-tested ESM reducer load instantaneously, scale crisply, and work 100% offline.',
        steps: [
          'Create analytics-store.mjs with filtering, KPI aggregation, and CSV serialization + node:test suite.',
          'Render KPI cards, SVG bar chart, SVG breakdown donut, filter bar, and CSV download trigger.',
          'Run unit tests, start preview, and verify DOM/assets/syntax.',
        ],
        risks: ['Division by zero on empty filtered datasets', 'CSV formula/comma escaping bugs'],
        edgeCases: ['Zero records match filter', 'RFC-4180 CSV quoting on commas/quotes'],
        acceptanceCriteria: ['Interactive charts update on filter change', 'CSV export escapes cleanly', 'node --test and verify_web_app pass'],
      };

    case 'mobile_app':
      return {
        language,
        goal: `${metaNote} Build a mobile-first ${parsed.brand} companion app packaged for Capacitor Android APK`,
        projectType: 'crud_app',
        options: [
          {
            id: 'opt-1',
            title: 'Mobile-First Touch SPA + Capacitor 7 Android Config + Tested Store',
            summary: 'Responsive touch-optimized bottom-tab app with safe-area CSS, offline localStorage, capacitor.config.json, and Android build scripts.',
            stack: ['HTML5/CSS3 Touch UI', 'ES Modules', 'Capacitor Android Config', 'node:test'],
            tradeoffs: 'Ready to preview live in browser immediately and compile to Android APK with npx cap add android.',
          },
          {
            id: 'opt-2',
            title: 'Expo React Native Monorepo',
            summary: 'Native JS bridge project.',
            stack: ['React Native', 'Expo'],
            tradeoffs: 'Requires heavy Metro bundler + Android SDK setup before preview.',
          },
          {
            id: 'opt-3',
            title: 'Desktop-First Web Page',
            summary: 'Standard desktop web layout.',
            stack: ['HTML'],
            tradeoffs: 'Poor thumb-zone ergonomics on mobile devices.',
          },
        ],
        chosenOptionId: 'opt-1',
        rationaleOneLine: 'A mobile-first touch SPA paired with Capacitor config previews live immediately while remaining directly packagable into an Android APK.',
        steps: [
          'Build mobile touch shell with bottom navigation tabs, offline store, and safe-area layout.',
          'Generate capacitor.config.json, package.json, and ANDROID_BUILD.md packaging steps.',
          'Run unit tests and verify mobile-ready viewport/DOM/syntax.',
        ],
        risks: ['Small touch targets below 44px', 'Missing Capacitor webDir alignment'],
        edgeCases: ['Offline persistence', 'Long titles overflowing 375px viewport'],
        acceptanceCriteria: ['capacitor.config.json aligns webDir="."', 'Touch-friendly controls verified', 'node --test and verify_web_app pass'],
      };

    case 'api_service':
      return {
        language,
        goal: `${metaNote} Build a resilient Node.js REST API for ${parsed.entity.plural} with OpenAPI & Dockerfile`,
        projectType: 'api_service',
        options: [
          {
            id: 'opt-1',
            title: 'Zero-Dependency Node 22 ESM HTTP + OpenAPI Spec + node:test + Dockerfile',
            summary: 'Native node:http router with strict validation, security headers, /openapi.json contract, and integration tests.',
            stack: ['Node.js ESM', 'node:http', 'node:test', 'Docker'],
            tradeoffs: 'Zero install latency and instant testability.',
          },
          {
            id: 'opt-2',
            title: 'Express 5 + Zod Validation',
            summary: 'Express middleware pipeline.',
            stack: ['Express 5', 'Zod'],
            tradeoffs: 'Requires workspace npm install before running.',
          },
          {
            id: 'opt-3',
            title: 'Python FastAPI',
            summary: 'ASGI Python service.',
            stack: ['Python', 'FastAPI'],
            tradeoffs: 'Requires pip virtualenv.',
          },
        ],
        chosenOptionId: 'opt-1',
        rationaleOneLine: 'Zero-dependency Node 22 ESM boots instantaneously, serves /health + /openapi.json + CRUD routes, and passes integration tests immediately.',
        steps: [
          `Build server.js with /health, /openapi.json, and ${parsed.entity.apiPath} CRUD + OWASP headers.`,
          'Add Dockerfile for production containerization.',
          'Write and run tests/api.test.mjs via node --test.',
        ],
        risks: ['Malformed JSON crashing request handler', 'Oversized body memory abuse'],
        edgeCases: ['Empty required fields (400)', 'Missing resource ID (404)', 'Payload > 100KB (413)'],
        acceptanceCriteria: ['GET /health returns 200', 'CRUD + OpenAPI endpoints pass node --test'],
      };

    case 'crud_app':
      return {
        language,
        goal: `${metaNote} Build a ${parsed.entity.plural} CRUD manager for ${parsed.brand}`,
        projectType: 'crud_app',
        options: [
          {
            id: 'opt-1',
            title: `Shared Pure-JS ${parsed.entity.singular} Reducer + Reactive UI + CSV Export + node:test`,
            summary: 'Domain-tailored state reducer shared between UI and automated tests, with search, filter, and CSV export.',
            stack: ['HTML5', 'CSS3 Grid', 'ES2023 Modules', 'node:test'],
            tradeoffs: 'Instant zero-build preview and directly unit-tested CRUD invariants.',
          },
          {
            id: 'opt-2',
            title: 'React + Vite SPA',
            summary: 'Compiled component bundle.',
            stack: ['React', 'Vite'],
            tradeoffs: 'Needs per-workspace npm install.',
          },
          {
            id: 'opt-3',
            title: 'Server-Rendered Forms',
            summary: 'Full page POST reloads.',
            stack: ['Express', 'HTML'],
            tradeoffs: 'Slower UX feedback loop.',
          },
        ],
        chosenOptionId: 'opt-1',
        rationaleOneLine: `Sharing store.mjs between the ${parsed.entity.plural} UI and node:test guarantees verified business logic with zero install overhead.`,
        steps: [
          `Implement domain reducer in store.mjs for ${parsed.entity.plural} (create, toggle, filter, search, exportCsv).`,
          'Build accessible responsive UI in index.html, styles.css, and app.js.',
          'Run tests/store.test.mjs and verify_web_app.',
        ],
        risks: ['XSS if rendering user input via innerHTML', 'Corrupted localStorage state'],
        edgeCases: ['Empty input rejected', 'Search + status filter compose cleanly'],
        acceptanceCriteria: ['Domain-specific entity UI renders cleanly', 'node --test and verify_web_app pass'],
      };

    case 'game_2d':
      return {
        language,
        goal: `${metaNote} Build a playable 60 FPS 2D Canvas arcade game`,
        projectType: 'game_2d',
        options: [
          {
            id: 'opt-1',
            title: 'Custom Fixed-Timestep Canvas 2D Engine + Particles + Touch/Keyboard',
            summary: 'Zero-dependency ES module game loop with delta clamping, parallax starfield, waves, and HUD.',
            stack: ['HTML5 Canvas', 'CSS3', 'ES2023 Modules'],
            tradeoffs: 'Instant load and deterministic 60 FPS control.',
          },
          {
            id: 'opt-2',
            title: 'Phaser 3 Framework',
            summary: 'Heavy external framework.',
            stack: ['Phaser 3'],
            tradeoffs: 'External bundle reliance.',
          },
          {
            id: 'opt-3',
            title: 'DOM Sprite Loop',
            summary: 'CSS-positioned divs.',
            stack: ['HTML/CSS'],
            tradeoffs: 'Frame drops under particle bursts.',
          },
        ],
        chosenOptionId: 'opt-1',
        rationaleOneLine: 'A native Canvas 2D fixed-timestep engine guarantees zero external asset risk and silky 60 FPS responsiveness.',
        steps: [
          'Create game HUD shell with score, lives, wave, pause, and restart controls.',
          'Implement 60 FPS Canvas loop in game.js with keyboard + touch input.',
          'Start preview and verify DOM, assets, and JS syntax.',
        ],
        risks: ['Variable monitor refresh speed', 'Lost keyboard focus'],
        edgeCases: ['Restart resets waves/lives cleanly', 'Delta-time capped on tab switch'],
        acceptanceCriteria: ['Playable canvas + HUD + restart verified', 'Zero JS syntax errors'],
      };

    case 'followup_edit':
      return {
        language,
        goal: `${metaNote} Apply targeted incremental edits to the existing workspace`,
        projectType: 'landing_page',
        options: [
          {
            id: 'opt-1',
            title: 'Inspect Existing Workspace Files & Apply Surgical Edits',
            summary: 'Reads current HTML/CSS/JS via read_file, patches requested theme/brand/sections, and re-verifies.',
            stack: ['read_file', 'edit_file', 'verify_web_app'],
            tradeoffs: 'Preserves existing code structure while updating targeted sections.',
          },
          {
            id: 'opt-2',
            title: 'Full Workspace Regeneration',
            summary: 'Overwrites everything from scratch.',
            stack: ['write_file'],
            tradeoffs: 'Discards prior customizations.',
          },
        ],
        chosenOptionId: 'opt-1',
        rationaleOneLine: 'Reading existing workspace files and patching surgically preserves prior customizations while satisfying the follow-up request.',
        steps: [
          'Inspect existing files with repo_map and read_file.',
          'Apply targeted updates (theme, brand, or sections) via edit_file/write_file.',
          'Re-verify live preview with verify_web_app.',
        ],
        risks: ['Breaking existing CSS variables or asset links'],
        edgeCases: ['Missing target selectors handled safely'],
        acceptanceCriteria: ['Updated files reflect user requested changes', 'verify_web_app passes'],
      };

    default:
      return {
        language,
        goal: `${metaNote} Design, build, and verify a modern ${parsed.brand} web experience`,
        projectType: 'landing_page',
        options: [
          {
            id: 'opt-1',
            title: `Tailored ${parsed.brand} Semantic HTML5 + Fluid CSS3 + Interactive ES Module`,
            summary: 'Domain-matched palette, custom SVG visual, interactive estimator, SEO JSON-LD, theme toggle, and validated form.',
            stack: ['HTML5 + JSON-LD', 'Modern CSS3', 'ES2023 Modules'],
            tradeoffs: 'Zero build lag and 100% self-contained reliability.',
          },
          {
            id: 'opt-2',
            title: 'React + Vite Marketing SPA',
            summary: 'Component SPA compiled via Vite.',
            stack: ['React', 'Vite'],
            tradeoffs: 'Install overhead for content-focused marketing site.',
          },
          {
            id: 'opt-3',
            title: 'Minimal Single-File Inline HTML',
            summary: 'All markup, styles, and logic in one file.',
            stack: ['HTML'],
            tradeoffs: 'Weaker separation of concerns.',
          },
        ],
        chosenOptionId: 'opt-1',
        rationaleOneLine: 'Semantic HTML5 + CSS3 custom properties + ES modules renders instantaneously, isolates concerns cleanly, and passes full DOM/SEO/asset checks.',
        steps: [
          `Craft ${parsed.brand} semantic layout, custom SVG hero graphic, interactive estimator, and validated signup form.`,
          `Apply ${parsed.palette.name} CSS design tokens and responsive layout rules.`,
          'Start preview and verify HTTP 200, asset links, DOM/a11y, and JS syntax.',
        ],
        risks: ['Root-relative asset path breaks behind proxy', 'Mobile overflow'],
        edgeCases: ['375px viewport responsiveness', 'Invalid email validation feedback'],
        acceptanceCriteria: ['HTTP 200 on all assets', 'Semantic landmarks, viewport, and JS syntax verified'],
      };
  }
}

export function synthesizeFilesForIntent(parsed: ParsedPromptIntent): SynthesizedFile[] {
  switch (parsed.intent) {
    case 'game_3d':
      return synthesize3DGameSlice(parsed);
    case 'analytics_dashboard':
      return synthesizeAnalyticsDashboard(parsed);
    case 'crud_app':
      return synthesizeCrudApp(parsed);
    case 'mobile_app':
      return synthesizeMobileApp(parsed);
    case 'api_service':
      return synthesizeApiService(parsed);
    case 'game_2d':
      return synthesize2DGame(parsed);
    default:
      return synthesizeLandingPage(parsed);
  }
}

function synthesizeLandingPage(parsed: ParsedPromptIntent): SynthesizedFile[] {
  const { brand, tagline, palette, language, features } = parsed;
  const ctaLabel =
    language === 'si'
      ? 'දැන්ම ආරම්භ කරන්න'
      : language === 'singlish'
        ? 'Danma Start Karanna'
        : 'Launch Workspace';
  const badgeLabel =
    language === 'si'
      ? 'නව පරපුරේ තාක්ෂණය'
      : language === 'singlish'
        ? 'Aluth First-Principles Tech'
        : 'Built From First Principles';

  const pricingHtml = features.wantsPricing
    ? `
    <section id="pricing" class="container section">
      <h2>Transparent Plans</h2>
      <div class="grid-3">
        <article class="card"><h3>Starter</h3><p class="price">$0 / mo</p><p>Core workspace, live preview, and local verification.</p></article>
        <article class="card"><h3>Pro Studio</h3><p class="price">$29 / mo</p><p>Multi-model reasoning routing, team checkpoints, and CI evals.</p></article>
        <article class="card"><h3>Enterprise</h3><p class="price">Custom</p><p>Dedicated VPC deployment, SSO, and audit trails.</p></article>
      </div>
    </section>`
    : '';

  const indexHtml = `<!doctype html>
<html lang="${language === 'si' ? 'si' : 'en'}" data-theme="${palette.defaultTheme}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="${brand} — ${tagline}" />
  <title>${brand} | ${parsed.domain === 'general' ? 'Autonomous Architecture' : parsed.domain.toUpperCase()}</title>
  <link rel="stylesheet" href="./styles.css" />
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Organization","name":"${brand}","description":"${tagline}"}
  </script>
</head>
<body>
  <header class="site-header">
    <div class="container nav-row">
      <a href="#top" class="brand" aria-label="${brand} home">
        <span class="brand-mark" aria-hidden="true">◆</span>
        <span>${brand}</span>
      </a>
      <nav aria-label="Primary navigation" class="nav-links">
        <a href="#architecture">Capabilities</a>
        <a href="#estimator">Impact</a>
        ${features.wantsPricing ? '<a href="#pricing">Pricing</a>' : ''}
        <a href="#early-access">Access</a>
      </nav>
      <div class="nav-actions">
        <button id="theme-toggle" type="button" class="btn btn-ghost" aria-label="Toggle color theme">Theme</button>
        <a href="#early-access" class="btn btn-primary">${ctaLabel}</a>
      </div>
    </div>
  </header>

  <main id="top">
    <section class="hero container">
      <div class="hero-copy">
        <span class="pill">${badgeLabel}</span>
        <h1>${brand}</h1>
        <p class="lead">${tagline}</p>
        <div class="hero-cta-row">
          <a href="#early-access" class="btn btn-primary">${ctaLabel}</a>
          <a href="#architecture" class="btn btn-secondary">Explore Capabilities</a>
        </div>
        <dl class="metrics" aria-label="Key metrics">
          <div><dt>Latency</dt><dd>&lt; 18 ms</dd></div>
          <div><dt>Reliability</dt><dd>99.94%</dd></div>
          <div><dt>Zero Legacy</dt><dd>100%</dd></div>
        </dl>
      </div>
      <div class="hero-visual">
        <svg viewBox="0 0 360 280" role="img" aria-label="${brand} architecture visual" class="hero-svg">
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="${palette.accent}"/>
              <stop offset="100%" stop-color="${palette.accent2}"/>
            </linearGradient>
          </defs>
          <rect x="16" y="16" width="328" height="248" rx="18" fill="${palette.surface}" stroke="url(#g1)" stroke-width="2"/>
          <circle cx="180" cy="140" r="68" fill="none" stroke="url(#g1)" stroke-width="3" stroke-dasharray="8 6"/>
          <circle cx="180" cy="140" r="34" fill="url(#g1)" opacity="0.28"/>
          <circle cx="180" cy="140" r="14" fill="${palette.accent2}"/>
          <circle cx="112" cy="96" r="10" fill="${palette.accent}"/>
          <circle cx="248" cy="184" r="10" fill="${palette.accent2}"/>
          <line x1="120" y1="102" x2="170" y2="134" stroke="${palette.accent}" stroke-width="2"/>
          <line x1="190" y1="146" x2="240" y2="178" stroke="${palette.accent2}" stroke-width="2"/>
        </svg>
      </div>
    </section>

    <section id="architecture" class="container section">
      <h2>First-Principles Engineering</h2>
      <div class="grid-3">
        <article class="card">
          <h3>Purpose-Built Core</h3>
          <p>Designed around exact user outcomes without legacy boilerplate or external bloat.</p>
        </article>
        <article class="card">
          <h3>Continuous Verification</h3>
          <p>Every asset, interactive flow, and contract is checked automatically before delivery.</p>
        </article>
        <article class="card">
          <h3>Instant Global Scale</h3>
          <p>Fluid edge-ready layouts and compact state modules that adapt cleanly to every screen.</p>
        </article>
      </div>
    </section>

    <section id="estimator" class="container section estimator-box">
      <h2>Interactive Output Estimator</h2>
      <p>Adjust active nodes to project real-time throughput and overhead reduction.</p>
      <div class="estimator-controls">
        <label for="scale-range">Active Nodes: <strong id="scale-value">12</strong></label>
        <input id="scale-range" type="range" min="1" max="100" value="12" />
      </div>
      <div class="estimator-readout" aria-live="polite">
        <div><span>Projected Throughput</span><strong id="throughput-out">14.4k req/s</strong></div>
        <div><span>Overhead Saved</span><strong id="savings-out">42%</strong></div>
      </div>
    </section>
    ${pricingHtml}
    <section id="early-access" class="container section">
      <div class="cta-panel">
        <h2>Request Early Access</h2>
        <p>Join builders shipping with ${brand}.</p>
        <form id="waitlist-form" class="waitlist-form" novalidate>
          <label class="sr-only" for="email-input">Work email</label>
          <input id="email-input" type="email" required placeholder="you@domain.com" />
          <button type="submit" class="btn btn-primary">${ctaLabel}</button>
        </form>
        <p id="form-feedback" class="feedback" role="status" aria-live="polite"></p>
      </div>
    </section>
  </main>

  <footer class="site-footer container">
    <p>&copy; 2026 ${brand}. Synthesized &amp; verified by Axiom Native AI.</p>
  </footer>
  <script type="module" src="./app.js"></script>
</body>
</html>
`;

  const stylesCss = `:root {
  --bg: ${palette.bg};
  --surface: ${palette.surface};
  --border: rgba(148, 163, 184, 0.2);
  --text: ${palette.text};
  --muted: ${palette.muted};
  --accent: ${palette.accent};
  --accent-2: ${palette.accent2};
}
[data-theme='light'] {
  --bg: #f8fafc;
  --surface: #ffffff;
  --border: rgba(15, 23, 42, 0.12);
  --text: #0f172a;
  --muted: #475569;
}
[data-theme='dark'] {
  --bg: ${palette.defaultTheme === 'light' ? '#070b14' : palette.bg};
  --surface: ${palette.defaultTheme === 'light' ? '#101726' : palette.surface};
  --text: ${palette.defaultTheme === 'light' ? '#f8fafc' : palette.text};
  --muted: ${palette.defaultTheme === 'light' ? '#94a3b8' : palette.muted};
}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  font-family: Inter, system-ui, -apple-system, sans-serif;
  background: var(--bg); color: var(--text); line-height: 1.6;
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
.price { font-size: 1.5rem; font-weight: 700; color: var(--accent-2); margin: 0.3rem 0; }
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
@media (max-width: 640px) { .nav-links { display: none; } }
`;

  const appJs = `const root = document.documentElement;
document.getElementById('theme-toggle')?.addEventListener('click', () => {
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
  if (feedback) feedback.textContent = 'Confirmed! ' + value + ' added to the ${brand} early-access queue.';
  form.reset();
});
`;

  return [
    { path: 'index.html', content: indexHtml },
    { path: 'styles.css', content: stylesCss },
    { path: 'app.js', content: appJs },
  ];
}

function synthesizeCrudApp(parsed: ParsedPromptIntent): SynthesizedFile[] {
  const { brand, entity, palette } = parsed;
  const storeMjs = `export function createItem(items, title, secondary = ${JSON.stringify(entity.secondaryOptions[0])}) {
  const clean = String(title || '').trim();
  if (!clean) throw new Error('${entity.singular} title is required');
  const next = {
    id: 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    title: clean,
    secondary,
    done: false,
    createdAt: new Date().toISOString(),
  };
  return [next, ...items];
}

export function toggleItem(items, id) {
  return items.map((item) => (item.id === id ? { ...item, done: !item.done } : item));
}

export function deleteItem(items, id) {
  return items.filter((item) => item.id !== id);
}

export function filterItems(items, filter = 'all', query = '') {
  const q = String(query || '').trim().toLowerCase();
  return items.filter((item) => {
    if (filter === 'active' && item.done) return false;
    if (filter === 'done' && !item.done) return false;
    if (q && !item.title.toLowerCase().includes(q) && !String(item.secondary).toLowerCase().includes(q)) return false;
    return true;
  });
}

export function toCsv(items) {
  const escape = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = [['ID', 'Title', ${JSON.stringify(entity.secondaryFieldLabel)}, 'Status', 'CreatedAt']];
  for (const it of items) {
    rows.push([it.id, it.title, it.secondary, it.done ? 'Completed' : 'Active', it.createdAt]);
  }
  return rows.map((r) => r.map(escape).join(',')).join('\\n');
}
`;

  const optionsHtml = entity.secondaryOptions
    .map((o) => `<option value="${o}">${o}</option>`)
    .join('');

  const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${brand} — ${entity.plural} Manager</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <header class="header">
    <div class="container header-row">
      <div>
        <h1>${brand} · ${entity.plural}</h1>
        <p>Modular CRUD tracker with real-time filter, search, and CSV export.</p>
      </div>
      <button id="export-csv" type="button" class="btn-secondary">Export CSV</button>
    </div>
  </header>
  <main class="container">
    <section class="panel" aria-label="Create ${entity.singular}">
      <form id="item-form" class="row">
        <label class="sr-only" for="item-title">${entity.singular} title</label>
        <input id="item-title" type="text" placeholder="Add new ${entity.singular.toLowerCase()}..." required />
        <label class="sr-only" for="item-secondary">${entity.secondaryFieldLabel}</label>
        <select id="item-secondary">${optionsHtml}</select>
        <button type="submit" class="btn-primary">Add ${entity.singular}</button>
      </form>
      <div class="toolbar">
        <div class="filters" role="group" aria-label="Filter ${entity.plural}">
          <button type="button" data-filter="all" class="active">All</button>
          <button type="button" data-filter="active">Active</button>
          <button type="button" data-filter="done">Completed</button>
        </div>
        <label class="sr-only" for="search-input">Search ${entity.plural}</label>
        <input id="search-input" type="search" placeholder="Search ${entity.plural.toLowerCase()}..." />
      </div>
    </section>
    <section class="panel" aria-label="${entity.plural} list">
      <div id="stats" class="stats" aria-live="polite"></div>
      <ul id="item-list" class="item-list"></ul>
    </section>
  </main>
  <footer class="container footer">Built &amp; tested by Axiom Native AI (${entity.plural} store).</footer>
  <script type="module" src="./app.js"></script>
</body>
</html>
`;

  const stylesCss = `*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; background: ${palette.bg}; color: ${palette.text}; line-height: 1.5; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
.container { max-width: 820px; margin: 0 auto; padding: 1rem 1.25rem; }
.header { border-bottom: 1px solid rgba(148,163,184,0.2); padding: 0.75rem 0; }
.header-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.header h1 { margin: 0; font-size: 1.5rem; }
.header p { margin: 0.2rem 0 0; color: ${palette.muted}; }
.panel { background: ${palette.surface}; border: 1px solid rgba(148,163,184,0.2); border-radius: 14px; padding: 1.2rem; margin-top: 1.2rem; }
.row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
input, select { background: ${palette.bg}; color: ${palette.text}; border: 1px solid rgba(148,163,184,0.3); border-radius: 8px; padding: 0.6rem 0.8rem; }
#item-title { flex: 1 1 240px; }
button { cursor: pointer; border-radius: 8px; border: 1px solid rgba(148,163,184,0.3); padding: 0.55rem 0.9rem; background: ${palette.surface}; color: ${palette.text}; }
.btn-primary { background: ${palette.accent}; border-color: ${palette.accent}; color: #fff; font-weight: 600; }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; margin-top: 1rem; flex-wrap: wrap; }
.filters { display: flex; gap: 0.4rem; }
.filters button.active { background: ${palette.accent2}; border-color: ${palette.accent2}; color: #042f2e; font-weight: 600; }
.stats { font-size: 0.88rem; color: ${palette.muted}; margin-bottom: 0.75rem; }
.item-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.55rem; }
.item-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; background: ${palette.bg}; padding: 0.75rem; border-radius: 10px; border: 1px solid rgba(148,163,184,0.2); }
.item-row.done .title { text-decoration: line-through; opacity: 0.6; }
.badge { font-size: 0.75rem; padding: 0.15rem 0.55rem; border-radius: 999px; background: rgba(99,102,241,0.16); color: ${palette.accent2}; }
.footer { color: ${palette.muted}; font-size: 0.85rem; }
`;

  const appJs = `import { createItem, toggleItem, deleteItem, filterItems, toCsv } from './store.mjs';

const STORAGE_KEY = 'axiom_crud_${entity.plural.toLowerCase().replace(/[^a-z0-9]/g, '_')}_v1';
const SEED = ${JSON.stringify(entity.sampleItems)};
let items = loadItems();
let activeFilter = 'all';
let searchQuery = '';

function loadItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return SEED.map((s, idx) => ({
        id: 'seed-' + idx,
        title: s.title,
        secondary: s.secondary,
        done: Boolean(s.done),
        createdAt: new Date().toISOString(),
      }));
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }

function render() {
  const list = document.getElementById('item-list');
  const stats = document.getElementById('stats');
  if (!list || !stats) return;
  const doneCount = items.filter((t) => t.done).length;
  stats.textContent = items.length + ' total · ' + doneCount + ' completed';
  const visible = filterItems(items, activeFilter, searchQuery);
  list.replaceChildren();

  if (visible.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'item-row';
    empty.textContent = 'No matching ${entity.plural.toLowerCase()}.';
    list.appendChild(empty);
    return;
  }

  for (const it of visible) {
    const li = document.createElement('li');
    li.className = 'item-row' + (it.done ? ' done' : '');
    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '0.6rem';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.textContent = it.done ? '✓' : '○';
    toggleBtn.setAttribute('aria-label', 'Toggle ' + it.title);
    toggleBtn.addEventListener('click', () => {
      items = toggleItem(items, it.id);
      save();
      render();
    });

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = it.title;

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = it.secondary;
    left.append(toggleBtn, title, badge);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      items = deleteItem(items, it.id);
      save();
      render();
    });

    li.append(left, delBtn);
    list.appendChild(li);
  }
}

document.getElementById('item-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const titleEl = document.getElementById('item-title');
  const secEl = document.getElementById('item-secondary');
  try {
    items = createItem(items, titleEl.value, secEl.value);
    titleEl.value = '';
    save();
    render();
  } catch { /* ignore empty */ }
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

document.getElementById('export-csv')?.addEventListener('click', () => {
  const csv = toCsv(filterItems(items, activeFilter, searchQuery));
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '${entity.plural.toLowerCase()}.csv';
  a.click();
});

render();
`;

  const testMjs = `import test from 'node:test';
import assert from 'node:assert/strict';
import { createItem, toggleItem, deleteItem, filterItems, toCsv } from '../store.mjs';

test('${entity.singular} CRUD invariants and CSV export', () => {
  let list = [];
  list = createItem(list, 'First ${entity.singular}', ${JSON.stringify(entity.secondaryOptions[0])});
  list = createItem(list, 'Second "Quoted", Item', ${JSON.stringify(entity.secondaryOptions[1] ?? entity.secondaryOptions[0])});
  assert.equal(list.length, 2);

  const id = list[0].id;
  list = toggleItem(list, id);
  assert.equal(filterItems(list, 'done').length, 1);
  assert.equal(filterItems(list, 'active').length, 1);
  assert.equal(filterItems(list, 'all', 'quoted').length, 1);

  const csv = toCsv(list);
  assert.ok(csv.includes('""Quoted""'));

  list = deleteItem(list, id);
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

function synthesizeAnalyticsDashboard(parsed: ParsedPromptIntent): SynthesizedFile[] {
  const { brand, palette } = parsed;
  const storeMjs = `export const SERIES_DATA = {
  '7d': [
    { label: 'Mon', revenue: 4200, orders: 64, segment: 'Direct' },
    { label: 'Tue', revenue: 5800, orders: 82, segment: 'API' },
    { label: 'Wed', revenue: 5100, orders: 71, segment: 'Partner' },
    { label: 'Thu', revenue: 7400, orders: 109, segment: 'Direct' },
    { label: 'Fri', revenue: 8900, orders: 132, segment: 'API' },
    { label: 'Sat', revenue: 6400, orders: 91, segment: 'Direct' },
    { label: 'Sun', revenue: 7900, orders: 118, segment: 'Partner' },
  ],
  '30d': [
    { label: 'Wk 1', revenue: 28400, orders: 410, segment: 'Direct' },
    { label: 'Wk 2', revenue: 34200, orders: 495, segment: 'API' },
    { label: 'Wk 3', revenue: 39800, orders: 560, segment: 'Partner' },
    { label: 'Wk 4', revenue: 46500, orders: 642, segment: 'Direct' },
  ],
};

export function summarizeSeries(rows) {
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalOrders = rows.reduce((s, r) => s + r.orders, 0);
  const avgOrder = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
  return { totalRevenue, totalOrders, avgOrder };
}

export function serializeCsv(rows) {
  const lines = ['Period,Revenue,Orders,Segment'];
  for (const r of rows) lines.push([r.label, r.revenue, r.orders, r.segment].join(','));
  return lines.join('\\n');
}
`;

  const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${brand} — Telemetry &amp; Analytics Dashboard</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <header class="topbar">
    <div class="container top-row">
      <div>
        <h1>${brand} Analytics</h1>
        <p>Live SVG visualization &amp; KPI telemetry</p>
      </div>
      <div class="controls">
        <button type="button" data-range="7d" class="active">7 Days</button>
        <button type="button" data-range="30d">30 Days</button>
        <button type="button" id="download-csv">Export CSV</button>
      </div>
    </div>
  </header>
  <main class="container">
    <section class="kpi-grid" aria-label="KPI summary">
      <article class="card"><span>Total Revenue</span><strong id="kpi-rev">$0</strong></article>
      <article class="card"><span>Total Orders</span><strong id="kpi-ord">0</strong></article>
      <article class="card"><span>Avg Ticket</span><strong id="kpi-avg">$0</strong></article>
    </section>
    <section class="charts-grid">
      <article class="card">
        <h2>Revenue Trend</h2>
        <svg id="bar-chart" viewBox="0 0 560 240" role="img" aria-label="Revenue bar chart"></svg>
      </article>
      <article class="card">
        <h2>Channel Breakdown</h2>
        <svg id="donut-chart" viewBox="0 0 240 240" role="img" aria-label="Channel share donut chart"></svg>
      </article>
    </section>
  </main>
  <footer class="container footer">Axiom Native AI — Pure SVG Telemetry Engine</footer>
  <script type="module" src="./app.js"></script>
</body>
</html>
`;

  const stylesCss = `* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; background: ${palette.bg}; color: ${palette.text}; }
.container { max-width: 1080px; margin: 0 auto; padding: 1rem 1.25rem; }
.topbar { border-bottom: 1px solid rgba(148,163,184,0.2); background: ${palette.surface}; }
.top-row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
h1 { margin: 0; font-size: 1.45rem; }
.topbar p { margin: 0.2rem 0 0; color: ${palette.muted}; font-size: 0.9rem; }
.controls { display: flex; gap: 0.5rem; }
button { background: ${palette.bg}; color: ${palette.text}; border: 1px solid rgba(148,163,184,0.3); border-radius: 8px; padding: 0.45rem 0.9rem; cursor: pointer; }
button.active { background: ${palette.accent}; border-color: ${palette.accent}; color: #fff; font-weight: 600; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1.2rem; }
.charts-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 1rem; margin-top: 1rem; }
.card { background: ${palette.surface}; border: 1px solid rgba(148,163,184,0.2); border-radius: 14px; padding: 1.2rem; }
.card span { display: block; color: ${palette.muted}; font-size: 0.85rem; }
.card strong { font-size: 1.7rem; color: ${palette.accent2}; }
svg { width: 100%; height: auto; display: block; }
.footer { color: ${palette.muted}; font-size: 0.85rem; }
@media (max-width: 780px) { .charts-grid { grid-template-columns: 1fr; } }
`;

  const appJs = `import { SERIES_DATA, summarizeSeries, serializeCsv } from './store.mjs';

let activeRange = '7d';

function render() {
  const rows = SERIES_DATA[activeRange] || [];
  const kpi = summarizeSeries(rows);
  document.getElementById('kpi-rev').textContent = '$' + kpi.totalRevenue.toLocaleString();
  document.getElementById('kpi-ord').textContent = kpi.totalOrders.toLocaleString();
  document.getElementById('kpi-avg').textContent = '$' + kpi.avgOrder;

  const svg = document.getElementById('bar-chart');
  const maxVal = Math.max(1, ...rows.map((r) => r.revenue));
  const barW = 460 / Math.max(1, rows.length);
  svg.replaceChildren();
  rows.forEach((r, idx) => {
    const h = Math.round((r.revenue / maxVal) * 165);
    const x = 50 + idx * barW + 8;
    const y = 195 - h;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(Math.max(18, barW - 18)));
    rect.setAttribute('height', String(h));
    rect.setAttribute('rx', '6');
    rect.setAttribute('fill', '${palette.accent}');
    const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    lbl.setAttribute('x', String(x + Math.max(18, barW - 18) / 2));
    lbl.setAttribute('y', '218');
    lbl.setAttribute('text-anchor', 'middle');
    lbl.setAttribute('fill', '${palette.muted}');
    lbl.setAttribute('font-size', '12');
    lbl.textContent = r.label;
    svg.append(rect, lbl);
  });

  const donut = document.getElementById('donut-chart');
  donut.replaceChildren();
  const colors = ['${palette.accent}', '${palette.accent2}', '#f59e0b'];
  const segTotals = new Map();
  for (const r of rows) segTotals.set(r.segment, (segTotals.get(r.segment) || 0) + r.revenue);
  let offset = 0;
  let cIdx = 0;
  const circ = 2 * Math.PI * 72;
  for (const [seg, val] of segTotals.entries()) {
    const frac = kpi.totalRevenue > 0 ? val / kpi.totalRevenue : 0;
    const len = frac * circ;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '120');
    circle.setAttribute('cy', '120');
    circle.setAttribute('r', '72');
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', colors[cIdx % colors.length]);
    circle.setAttribute('stroke-width', '26');
    circle.setAttribute('stroke-dasharray', len + ' ' + (circ - len));
    circle.setAttribute('stroke-dashoffset', String(-offset));
    circle.setAttribute('aria-label', seg + ': ' + Math.round(frac * 100) + '%');
    donut.appendChild(circle);
    offset += len;
    cIdx++;
  }
}

document.querySelectorAll('[data-range]').forEach((btn) => {
  btn.addEventListener('click', () => {
    activeRange = btn.dataset.range || '7d';
    document.querySelectorAll('[data-range]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  });
});

document.getElementById('download-csv')?.addEventListener('click', () => {
  const csv = serializeCsv(SERIES_DATA[activeRange] || []);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'analytics-' + activeRange + '.csv';
  a.click();
});

render();
`;

  const testMjs = `import test from 'node:test';
import assert from 'node:assert/strict';
import { SERIES_DATA, summarizeSeries, serializeCsv } from '../store.mjs';

test('Analytics metrics aggregation and CSV serialization', () => {
  const s = summarizeSeries(SERIES_DATA['7d']);
  assert.ok(s.totalRevenue > 0);
  assert.ok(s.avgOrder > 0);
  const csv = serializeCsv(SERIES_DATA['7d']);
  assert.ok(csv.includes('Period,Revenue,Orders,Segment'));
});
`;

  return [
    { path: 'store.mjs', content: storeMjs },
    { path: 'index.html', content: indexHtml },
    { path: 'styles.css', content: stylesCss },
    { path: 'app.js', content: appJs },
    { path: 'tests/analytics.test.mjs', content: testMjs },
  ];
}

function synthesize2DGame(parsed: ParsedPromptIntent): SynthesizedFile[] {
  const { palette } = parsed;
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
  <footer class="footer">Axiom Game Engine — Canvas 2D Vertical Slice</footer>
  <script type="module" src="./game.js"></script>
</body>
</html>
`;

  const stylesCss = `* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; background: ${palette.bg}; color: ${palette.text}; display: flex; flex-direction: column; min-height: 100vh; }
.hud-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.75rem 1.25rem; background: ${palette.surface}; border-bottom: 1px solid rgba(148,163,184,0.2); }
.hud-bar h1 { margin: 0; font-size: 1.15rem; color: ${palette.accent2}; }
.hud-stats { display: flex; gap: 1.25rem; font-size: 0.95rem; }
.hud-controls { display: flex; gap: 0.5rem; }
button { background: #1e293b; color: #f8fafc; border: 1px solid #334155; border-radius: 8px; padding: 0.4rem 0.85rem; cursor: pointer; }
.arena-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; }
canvas { max-width: 100%; height: auto; border-radius: 12px; border: 1px solid #1e293b; background: #02040a; box-shadow: 0 20px 50px rgba(0,0,0,0.6); }
.controls-hint, .footer { color: ${palette.muted}; font-size: 0.85rem; text-align: center; padding: 0.5rem; }
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
    paused: false, gameOver: false, score: 0, lives: 3, wave: 1, cooldown: 0, spawnTimer: 0.5,
    player: { x: canvas.width / 2, y: canvas.height - 46, speed: 340 },
    bullets: [], enemies: [], particles: [],
    stars: Array.from({ length: 55 }, () => ({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, s: 0.8 + Math.random() * 1.8 })),
  };
  syncHud();
}

function syncHud() {
  if (scoreEl) scoreEl.textContent = String(state.score);
  if (livesEl) livesEl.textContent = String(state.lives);
  if (waveEl) waveEl.textContent = String(state.wave);
}

window.addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
window.addEventListener('keyup', (e) => keys.delete(e.code));
document.getElementById('pause-btn')?.addEventListener('click', () => { state.paused = !state.paused; });
document.getElementById('restart-btn')?.addEventListener('click', resetState);

function spawnBurst(x, y, color) {
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 50 + Math.random() * 140;
    state.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.45, color });
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
    state.enemies.push({ x: 30 + Math.random() * (canvas.width - 60), y: -20, r: 14, vy: 75 + state.wave * 18 });
    state.spawnTimer = Math.max(0.32, 1.15 - state.wave * 0.08);
  }
  state.bullets = state.bullets.filter((b) => ((b.y += b.vy * dt), b.y > -20));
  const nextEnemies = [];
  for (const en of state.enemies) {
    en.y += en.vy * dt;
    let hit = false;
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      if (Math.hypot(b.x - en.x, b.y - en.y) < en.r + 5) {
        state.bullets.splice(i, 1);
        state.score += 100;
        state.wave = 1 + Math.floor(state.score / 800);
        spawnBurst(en.x, en.y, '${palette.accent2}');
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
    nextEnemies.push(en);
  }
  state.enemies = nextEnemies;
  state.particles = state.particles.filter((p) => ((p.x += p.vx * dt), (p.y += p.vy * dt), (p.life -= dt), p.life > 0));
}

function draw() {
  ctx.fillStyle = '#02040a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
  for (const st of state.stars) ctx.fillRect(st.x, st.y, st.s, st.s);
  ctx.fillStyle = '#10b981';
  ctx.beginPath();
  ctx.moveTo(state.player.x, state.player.y - 14);
  ctx.lineTo(state.player.x - 16, state.player.y + 12);
  ctx.lineTo(state.player.x + 16, state.player.y + 12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fbbf24';
  for (const b of state.bullets) ctx.fillRect(b.x - 2, b.y - 8, 4, 12);
  ctx.fillStyle = '${palette.accent}';
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

function synthesize3DGameSlice(parsed: ParsedPromptIntent): SynthesizedFile[] {
  const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${parsed.brand} — Aether District 07 (3D Open-World Slice)</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <header class="hud-top">
    <div class="hud-title">
      <h1>Aether District 07</h1>
      <span class="badge">Original IP · 3D Vertical Slice</span>
    </div>
    <div class="hud-stats" aria-live="polite">
      <span>Cash: <strong id="cash-out">$0</strong></span>
      <span>Speed: <strong id="speed-out">0 km/h</strong></span>
      <span>Vehicle: <strong id="vehicle-out">Interceptor Coupe</strong></span>
      <span>Mission: <strong id="mission-out">Drive to Green Pickup Beacon</strong></span>
    </div>
    <div class="hud-actions">
      <button id="vehicle-btn" type="button">Switch Vehicle (1-3)</button>
      <button id="time-btn" type="button">Day / Night (N)</button>
    </div>
  </header>

  <main class="viewport">
    <div id="scene-root" role="application" aria-label="3D Open World District Canvas"></div>
    <canvas id="minimap" width="144" height="144" aria-label="District radar minimap"></canvas>
    <div class="controls-overlay">
      <span>Drive: WASD / Arrows · Brake: Space · Switch Car: 1 / 2 / 3 · Cycle Time: N</span>
    </div>
  </main>

  <footer class="hud-footer">
    Three.js Local Engine · 3 Vehicles · Procedural City District · NPC Traffic AI · Active Mission
  </footer>
  <script type="module" src="./game.js"></script>
</body>
</html>
`;

  const stylesCss = `* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #050814; color: #f8fafc; font-family: Inter, system-ui, sans-serif; }
body { display: flex; flex-direction: column; }
.hud-top {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem;
  padding: 0.65rem 1rem; background: rgba(11, 15, 25, 0.92); border-bottom: 1px solid rgba(148, 163, 184, 0.2); z-index: 10;
}
.hud-title { display: flex; align-items: center; gap: 0.5rem; }
.hud-title h1 { margin: 0; font-size: 1rem; color: #38bdf8; }
.badge { font-size: 0.72rem; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(56,189,248,0.4); color: #7dd3fc; }
.hud-stats { display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.85rem; }
.hud-actions { display: flex; gap: 0.5rem; }
button { background: #1e293b; color: #f8fafc; border: 1px solid #334155; border-radius: 8px; padding: 0.35rem 0.75rem; cursor: pointer; font-size: 0.82rem; }
button:hover { border-color: #38bdf8; }
.viewport { position: relative; flex: 1; overflow: hidden; }
#scene-root { width: 100%; height: 100%; }
#minimap {
  position: absolute; bottom: 16px; left: 16px; border-radius: 12px;
  border: 2px solid rgba(56, 189, 248, 0.5); background: rgba(2, 6, 23, 0.85);
}
.controls-overlay {
  position: absolute; bottom: 16px; right: 16px; background: rgba(2, 6, 23, 0.78);
  padding: 6px 12px; border-radius: 8px; font-size: 0.78rem; color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.2);
}
.hud-footer { padding: 0.4rem 1rem; font-size: 0.75rem; color: #64748b; background: #070b14; border-top: 1px solid rgba(148,163,184,0.12); text-align: center; }
@media (max-width: 720px) { .controls-overlay { display: none; } }
`;

  const gameJs = `import * as THREE from './vendor/three.module.js';

const root = document.getElementById('scene-root');
const minimap = document.getElementById('minimap');
const mapCtx = minimap.getContext('2d');
const cashOut = document.getElementById('cash-out');
const speedOut = document.getElementById('speed-out');
const vehicleOut = document.getElementById('vehicle-out');
const missionOut = document.getElementById('mission-out');

const VEHICLES = [
  { name: 'Interceptor Coupe', color: 0x38bdf8, accel: 36, maxSpeed: 42, turnRate: 2.5, size: [2.1, 1.1, 4.2] },
  { name: 'Heavy Hauler', color: 0xf59e0b, accel: 22, maxSpeed: 30, turnRate: 1.7, size: [2.8, 2.0, 5.8] },
  { name: 'Recon Moto', color: 0x10b981, accel: 48, maxSpeed: 50, turnRate: 3.3, size: [1.0, 1.1, 2.5] },
];

const scene = new THREE.Scene();
let isNight = true;
scene.background = new THREE.Color(0x060916);
scene.fog = new THREE.FogExp2(0x060916, 0.0085);

const camera = new THREE.PerspectiveCamera(62, root.clientWidth / Math.max(1, root.clientHeight), 0.1, 320);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(root.clientWidth, Math.max(1, root.clientHeight));
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
root.appendChild(renderer.domElement);

const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.8);
const sunLight = new THREE.DirectionalLight(0xfef08a, 1.3);
sunLight.position.set(45, 70, 35);
scene.add(hemiLight, sunLight);

// Ground & procedural road grid
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(280, 280),
  new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.95 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const roadMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.85 });
const laneOffsets = [-60, -20, 20, 60];
for (const off of laneOffsets) {
  const rx = new THREE.Mesh(new THREE.BoxGeometry(240, 0.06, 9), roadMat);
  rx.position.set(0, 0.03, off);
  const rz = new THREE.Mesh(new THREE.BoxGeometry(9, 0.06, 240), roadMat);
  rz.position.set(off, 0.03, 0);
  scene.add(rx, rz);
}

// Procedural city blocks inside district quadrants
const blockMatA = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65 });
const blockMatB = new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x1d4ed8, emissiveIntensity: 0.18 });
for (let gx = -40; gx <= 40; gx += 40) {
  for (let gz = -40; gz <= 40; gz += 40) {
    const h = 10 + ((Math.abs(gx * 7 + gz * 13)) % 24);
    const b = new THREE.Mesh(new THREE.BoxGeometry(20, h, 20), (gx + gz) % 80 === 0 ? blockMatA : blockMatB);
    b.position.set(gx, h / 2, gz);
    scene.add(b);
  }
}

// Player vehicle mesh
let vehicleIdx = 0;
let playerMesh;
function buildPlayerVehicle(idx) {
  if (playerMesh) scene.remove(playerMesh);
  const spec = VEHICLES[idx];
  playerMesh = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(...spec.size),
    new THREE.MeshStandardMaterial({ color: spec.color, metalness: 0.35, roughness: 0.4 }),
  );
  body.position.y = spec.size[1] / 2 + 0.25;
  playerMesh.add(body);
  scene.add(playerMesh);
  vehicleOut.textContent = spec.name;
}
buildPlayerVehicle(0);

// NPC traffic vehicles cruising lanes
const traffic = [];
for (let i = 0; i < 8; i++) {
  const axis = i % 2 === 0 ? 'x' : 'z';
  const lane = laneOffsets[i % laneOffsets.length];
  const car = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 1.1, 4.0),
    new THREE.MeshStandardMaterial({ color: i % 3 === 0 ? 0xf43f5e : 0xa855f7 }),
  );
  const pos = -90 + i * 24;
  car.position.set(axis === 'x' ? pos : lane + 2, 0.75, axis === 'z' ? pos : lane - 2);
  if (axis === 'x') car.rotation.y = Math.PI / 2;
  scene.add(car);
  traffic.push({ mesh: car, axis, speed: (i % 2 === 0 ? 1 : -1) * (10 + (i % 4) * 3) });
}

// Mission pickup & dropoff beacon
const beaconGeo = new THREE.CylinderGeometry(1.8, 1.8, 10, 16);
const beaconMat = new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.65 });
const missionBeacon = new THREE.Mesh(beaconGeo, beaconMat);
scene.add(missionBeacon);

let missionStage = 'pickup';
let cash = 0;
const pickupPos = new THREE.Vector3(20, 5, -20);
const dropoffPos = new THREE.Vector3(-60, 5, 60);
missionBeacon.position.copy(pickupPos);

const playerState = { x: 0, z: 20, heading: 0, speed: 0 };
const keys = new Set();

function toggleDayNight() {
  isNight = !isNight;
  scene.background = new THREE.Color(isNight ? 0x060916 : 0x7dd3fc);
  scene.fog = new THREE.FogExp2(isNight ? 0x060916 : 0xbae6fd, isNight ? 0.0085 : 0.004);
  hemiLight.intensity = isNight ? 0.65 : 1.25;
  sunLight.intensity = isNight ? 0.85 : 1.9;
}

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Digit1') { vehicleIdx = 0; buildPlayerVehicle(0); }
  if (e.code === 'Digit2') { vehicleIdx = 1; buildPlayerVehicle(1); }
  if (e.code === 'Digit3') { vehicleIdx = 2; buildPlayerVehicle(2); }
  if (e.code === 'KeyN') toggleDayNight();
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
document.getElementById('vehicle-btn')?.addEventListener('click', () => {
  vehicleIdx = (vehicleIdx + 1) % VEHICLES.length;
  buildPlayerVehicle(vehicleIdx);
});
document.getElementById('time-btn')?.addEventListener('click', toggleDayNight);

window.addEventListener('resize', () => {
  const w = root.clientWidth;
  const h = Math.max(1, root.clientHeight);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

function drawMinimap() {
  mapCtx.fillStyle = '#020617';
  mapCtx.fillRect(0, 0, 144, 144);
  const toMap = (v) => 72 + (v / 110) * 65;

  // Roads
  mapCtx.fillStyle = '#334155';
  for (const off of laneOffsets) {
    mapCtx.fillRect(0, toMap(off) - 2, 144, 4);
    mapCtx.fillRect(toMap(off) - 2, 0, 4, 144);
  }
  // NPC traffic
  mapCtx.fillStyle = '#f43f5e';
  for (const t of traffic) {
    mapCtx.fillRect(toMap(t.mesh.position.x) - 2, toMap(t.mesh.position.z) - 2, 4, 4);
  }
  // Mission beacon
  mapCtx.fillStyle = missionStage === 'pickup' ? '#10b981' : '#f59e0b';
  mapCtx.beginPath();
  mapCtx.arc(toMap(missionBeacon.position.x), toMap(missionBeacon.position.z), 5, 0, Math.PI * 2);
  mapCtx.fill();
  // Player
  mapCtx.fillStyle = '#38bdf8';
  mapCtx.beginPath();
  mapCtx.arc(toMap(playerState.x), toMap(playerState.z), 4, 0, Math.PI * 2);
  mapCtx.fill();
}

let last = performance.now();
function animate(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const spec = VEHICLES[vehicleIdx];
  const fwd = (keys.has('KeyW') || keys.has('ArrowUp')) ? 1 : (keys.has('KeyS') || keys.has('ArrowDown')) ? -0.6 : 0;
  if (fwd !== 0) {
    playerState.speed += fwd * spec.accel * dt;
  } else {
    playerState.speed *= Math.max(0, 1 - 2.6 * dt);
  }
  if (keys.has('Space')) playerState.speed *= Math.max(0, 1 - 7 * dt);
  playerState.speed = Math.max(-14, Math.min(spec.maxSpeed, playerState.speed));

  const steer = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
  if (Math.abs(playerState.speed) > 0.5) {
    playerState.heading += steer * spec.turnRate * dt * Math.sign(playerState.speed);
  }

  playerState.x += Math.sin(playerState.heading) * playerState.speed * dt;
  playerState.z += Math.cos(playerState.heading) * playerState.speed * dt;
  playerState.x = Math.max(-110, Math.min(110, playerState.x));
  playerState.z = Math.max(-110, Math.min(110, playerState.z));

  playerMesh.position.set(playerState.x, 0, playerState.z);
  playerMesh.rotation.y = playerState.heading;
  speedOut.textContent = Math.round(Math.abs(playerState.speed) * 3.2) + ' km/h';

  // NPC traffic movement
  for (const t of traffic) {
    if (t.axis === 'x') {
      t.mesh.position.x += t.speed * dt;
      if (t.mesh.position.x > 110) t.mesh.position.x = -110;
      if (t.mesh.position.x < -110) t.mesh.position.x = 110;
    } else {
      t.mesh.position.z += t.speed * dt;
      if (t.mesh.position.z > 110) t.mesh.position.z = -110;
      if (t.mesh.position.z < -110) t.mesh.position.z = 110;
    }
  }

  // Mission distance check
  const dist = Math.hypot(playerState.x - missionBeacon.position.x, playerState.z - missionBeacon.position.z);
  missionBeacon.rotation.y += dt * 1.8;
  if (dist < 4.5) {
    if (missionStage === 'pickup') {
      missionStage = 'dropoff';
      missionBeacon.position.copy(dropoffPos);
      missionBeacon.material.color.setHex(0xf59e0b);
      missionOut.textContent = 'Deliver Package to Amber Dropoff Beacon';
    } else {
      cash += 2500;
      cashOut.textContent = '$' + cash.toLocaleString();
      missionStage = 'pickup';
      missionBeacon.position.copy(pickupPos);
      missionBeacon.material.color.setHex(0x10b981);
      missionOut.textContent = 'Mission Complete (+$2,500)! Next Pickup Ready';
    }
  }

  // Smooth third-person chase camera
  const camBack = 12;
  const camTarget = new THREE.Vector3(
    playerState.x - Math.sin(playerState.heading) * camBack,
    6.2,
    playerState.z - Math.cos(playerState.heading) * camBack,
  );
  camera.position.lerp(camTarget, 0.12);
  camera.lookAt(playerState.x, 1.5, playerState.z);

  drawMinimap();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
`;

  return [
    { path: 'index.html', content: indexHtml },
    { path: 'styles.css', content: stylesCss },
    { path: 'game.js', content: gameJs },
  ];
}

function synthesizeApiService(parsed: ParsedPromptIntent): SynthesizedFile[] {
  const { entity } = parsed;
  const resource = entity.apiPath;

  const serverJs = `import http from 'node:http';
import { randomUUID } from 'node:crypto';

export function createApp() {
  const records = new Map();

  function sendJson(res, status, data) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    });
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
        return sendJson(res, 200, { ok: true, service: '${parsed.brand.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-api' });
      }
      if (req.method === 'GET' && url.pathname === '/openapi.json') {
        return sendJson(res, 200, {
          openapi: '3.1.0',
          info: { title: '${parsed.brand} API', version: '1.0.0' },
          paths: { '/health': { get: {} }, '${resource}': { get: {}, post: {} } },
        });
      }
      if (req.method === 'GET' && url.pathname === '${resource}') {
        return sendJson(res, 200, { items: Array.from(records.values()) });
      }
      if (req.method === 'POST' && url.pathname === '${resource}') {
        const body = await readJson(req);
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        if (!title) return sendJson(res, 400, { error: 'title is required' });
        const item = { id: randomUUID().slice(0, 8), title, content, createdAt: new Date().toISOString() };
        records.set(item.id, item);
        return sendJson(res, 201, { item });
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('${resource}/')) {
        const id = url.pathname.slice('${resource}/'.length);
        if (!records.has(id)) return sendJson(res, 404, { error: 'Not found' });
        records.delete(id);
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
  createApp().listen(port, '0.0.0.0', () => console.log('API listening on 0.0.0.0:' + port));
}
`;

  const testMjs = `import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

test('${entity.plural} REST API health, OpenAPI, CRUD, and validation', async () => {
  const server = createApp();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  try {
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/openapi.json')).status, 200);

    const bad = await fetch(base + '${resource}', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '  ' }),
    });
    assert.equal(bad.status, 400);

    const created = await fetch(base + '${resource}', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'First ${entity.singular}', content: 'Verified contract' }),
    });
    assert.equal(created.status, 201);
    const createdJson = await created.json();

    const list = await (await fetch(base + '${resource}')).json();
    assert.equal(list.items.length, 1);

    const del = await fetch(base + '${resource}/' + createdJson.item.id, { method: 'DELETE' });
    assert.equal(del.status, 200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
`;

  const dockerfile = `FROM node:22-alpine
WORKDIR /app
COPY server.js ./
EXPOSE 4000
CMD ["node", "server.js"]
`;

  return [
    { path: 'server.js', content: serverJs },
    { path: 'tests/api.test.mjs', content: testMjs },
    { path: 'Dockerfile', content: dockerfile },
  ];
}

function synthesizeMobileApp(parsed: ParsedPromptIntent): SynthesizedFile[] {
  const baseFiles = synthesizeCrudApp(parsed).map((f) => {
    if (f.path !== 'index.html') return f;
    return {
      path: f.path,
      content: f.content.replace(
        '<link rel="stylesheet" href="./styles.css" />',
        '<link rel="manifest" href="./manifest.webmanifest" />\n  <link rel="icon" type="image/svg+xml" href="./icon.svg" />\n  <link rel="stylesheet" href="./styles.css" />',
      ),
    };
  });
  const capacitorConfig = {
    appId: `io.axiom.${parsed.brand.toLowerCase().replace(/[^a-z0-9]/g, '') || 'mobileapp'}`,
    appName: parsed.brand,
    webDir: '.',
    server: { androidScheme: 'https' },
  };
  const pkg = {
    name: parsed.brand.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    version: '1.0.0',
    scripts: {
      test: 'node --test tests/*.test.mjs',
      'cap:sync': 'npx cap sync android',
      'android:apk': 'cd android && ./gradlew assembleDebug',
    },
    dependencies: {
      '@capacitor/core': '^7.0.0',
      '@capacitor/android': '^7.0.0',
    },
  };
  const manifest = {
    name: parsed.brand,
    short_name: parsed.brand.slice(0, 12),
    start_url: './index.html',
    display: 'standalone',
    background_color: parsed.palette.bg,
    theme_color: parsed.palette.accent,
    icons: [{ src: './icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="42" fill="${parsed.palette.bg}"/><circle cx="96" cy="96" r="54" fill="${parsed.palette.accent}"/><circle cx="96" cy="96" r="24" fill="${parsed.palette.accent2}"/></svg>\n`;
  const ghWorkflow = `name: Build Android APK\non:\n  workflow_dispatch:\njobs:\n  apk:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: '22' }\n      - uses: actions/setup-java@v4\n        with: { distribution: 'temurin', java-version: '21' }\n      - uses: android-actions/setup-android@v3\n      - run: npm install && npx cap add android && npx cap sync android && cd android && chmod +x ./gradlew && ./gradlew assembleDebug\n      - uses: actions/upload-artifact@v4\n        with: { name: app-debug-apk, path: android/app/build/outputs/apk/debug/app-debug.apk }\n`;
  const guide = `# ${parsed.brand} Android APK & PWA Install Guide\n\n## Option 1: Install Instantly as PWA (No APK Needed)\nOpen the preview URL in Android Chrome and tap **Menu -> Install app / Add to Home screen**.\n\n## Option 2: Build Real Android APK on GitHub Actions (Free, No Local Android Studio)\nPush this folder to GitHub, open **Actions -> Build Android APK -> Run workflow**, and download \`app-debug-apk\`.\n\n## Option 3: Build APK Locally (Requires JDK 17/21 + Android SDK)\n1. \`npm install\`\n2. \`npx cap add android\`\n3. \`npm run cap:sync\`\n4. \`npm run android:apk\` -> outputs \`android/app/build/outputs/apk/debug/app-debug.apk\`\n`;

  return [
    ...baseFiles,
    { path: 'manifest.webmanifest', content: JSON.stringify(manifest, null, 2) },
    { path: 'icon.svg', content: iconSvg },
    { path: 'capacitor.config.json', content: JSON.stringify(capacitorConfig, null, 2) },
    { path: 'package.json', content: JSON.stringify(pkg, null, 2) },
    { path: '.github/workflows/build-apk.yml', content: ghWorkflow },
    { path: 'ANDROID_BUILD.md', content: guide },
  ];
}
