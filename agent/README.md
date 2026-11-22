# Axiom — Autonomous First-Principles AI Engineer-Architect

Axiom is an autonomous software-building AI agent with its own built-in neural & compositional engine (**Axiom Native AI**), designed from first principles to plan fresh architectural options, build real applications in sandboxed workspaces, verify outputs automatically, self-critique with Reviewer veto power, and serve live previews.

## Architecture

- **Axiom Native AI (`src/ai/`)**:
  - `src/ai/neural-core.ts`: Self-trained 2-layer MLP neural intent & domain network (`384 → 64 → 9`) over word/bigram + trilingual character-trigram features (English, Singlish, Sinhala), persisted to `data/axiom-brain.json` with online incremental learning after verified builds.
  - `src/ai/semantic-parser.ts`: Extracts brand, industry palette, domain entities (appointments, invoices, inventory, notes, tasks), UI features, and iterative follow-up edits.
  - `src/ai/synthesizer.ts`: Compositional synthesizer generating tailored Landing Pages, Domain CRUD Apps, Pure-SVG Analytics Dashboards, 2D Canvas Games, Playable **3D Three.js Open-World City Driving Vertical Slices** (3 vehicles, NPC traffic AI, day/night toggle, minimap, delivery mission), Node.js REST APIs + OpenAPI + Dockerfiles, and Capacitor Android APK scaffolds.
  - `src/ai/native-provider.ts`: Runs Axiom's native AI through the exact same `Planner → Builder → Tester → Reviewer` loop and tool calls as external LLMs.
- **Agent Loop (`src/core/loop.ts`)**: `understand → plan → act → observe → verify → reflect (veto/fix loop) → deliver` with SQLite checkpoints and resume support.
- **Specialist Role Routing (`src/llm/router.ts`)**: Uses **Axiom Native AI** out of the box with zero API keys, or automatically switches to Anthropic Claude, OpenAI, Google Gemini, or Local Ollama/vLLM when configured in `.env`. Routes `Planner`, `Reviewer`, `Researcher`, and hard-bug iterations to the **reasoning** model tier and routine execution to the **fast** model tier.
- **MCP-Compatible Tool Registry (`src/tools/`)**: Workspace-sandboxed files, `repo_map`, terminal execution with destructive-action safety gates, Git operations, SSRF-guarded web fetching, reverse-proxied live preview (`PreviewManager` with local Three.js vendor provisioning), and `verify_web_app` (`parse5` DOM/a11y, asset integrity, CSS responsiveness, and JS syntax validation).
- **Security (`src/core/security.ts`)**: Prompt-injection `<untrusted_data>` wrapping, tag-spoofing neutralization, symlink-safe path sandboxing, secret redaction, SSRF protection, and destructive command confirmation gates.
- **Memory & Evals (`src/memory/store.ts`, `src/evals/`)**: Node 22 built-in SQLite (`node:sqlite`) persistence for runs, action logs, checkpoints, project notes, long-term lessons, and Eval Suite v1.2.0 regression tracking.
- **Studio UI (`src/client/`)**: React 19 + Vite real-time SSE chat interface, execution trace, live preview iframe (`/preview/:projectId/`), workspace file viewer, verification matrix, **Brain AI** neural inspector/trainer, memory inspector, and eval runner.

## Quick Start

```bash
cd agent
npm install
cp .env.example .env   # Optional: add ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or LOCAL_LLM_BASE_URL
```

### Run Unified Production Studio (Recommended)
```bash
npm run build
npm start
# Opens http://0.0.0.0:3000 (API + UI + reverse-proxied /preview/:projectId/)
```

### Run Development Mode (API + Vite HMR)
```bash
npm run dev
```

### Run Tests & Benchmark Eval Suite v1
```bash
npm test      # Unit + integration tests (security, SQLite memory, router, verifier, agent loop)
npm run eval  # Benchmark Eval Suite v1 (landing page, CRUD app, 2D game, API, Singlish, security)
```

## Demo Walkthrough

1. Open the Axiom Studio UI.
2. Click or type: **`make me a landing page`** (or try Singlish: **`mata coffee shop ekakata lassana landing page ekak hadanna`**).
3. Watch `Planner` compare 2–3 approaches, `Builder` generate the files, `Tester` run live HTTP/DOM/asset/syntax verification, `Reviewer` score and approve, and the **Live Preview** tab render your running app.

## Roadmap

- **Phase 1 (Delivered)**: Chat Studio UI, autonomous loop + checkpoints, core sandboxed tools, multi-provider + model routing, verify + Reviewer veto loop, SQLite memory, Eval Suite v1.
- **Phase 2**: Headless Chromium screenshot/vision critique loop, browser E2E automation, 3D/Godot/Three.js game vertical slice pipeline, Capacitor/React Native APK build tools, GitHub PR & cloud deploy connectors.
- **Phase 3**: Live external MCP server transport (Gmail, Calendar, Drive, Slack, GitHub), Sinhala/English STT+TTS voice loop, automated prompt/tool self-improvement driven by eval regressions.
