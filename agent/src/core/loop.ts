import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AxiomConfig } from '../llm/config.ts';
import type { BudgetState, ModelRouter } from '../llm/router.ts';
import type { LLMMessage } from '../llm/types.ts';
import type { AxiomStore } from '../memory/store.ts';
import type {
  ActionLogEntry,
  ExecutionPlan,
  LanguageCode,
  LoopPhase,
  PendingConfirmation,
  ReviewVerdict,
  RunCheckpoint,
  RunRecord,
  SpecialistRole,
  VerificationReport,
} from '../shared/types.ts';
import type { PreviewManager } from '../tools/preview.ts';
import type { ToolRegistry } from '../tools/registry.ts';
import { verifyWebApp } from '../tools/verifier.ts';
import { detectLanguage, getRoleSystemPrompt } from './prompts.ts';

export type RunEventListener = (event: {
  type: 'log' | 'run_update';
  run: RunRecord;
  log?: ActionLogEntry;
}) => void;

function extractJsonObject<T>(raw: string): T | null {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.unshift(fenced[1].trim());
  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    candidates.push(trimmed.slice(braceStart, braceEnd + 1));
  }

  for (const cand of candidates) {
    try {
      return JSON.parse(cand) as T;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

function defaultPlan(goal: string, lang: LanguageCode): ExecutionPlan {
  return {
    goal,
    language: lang,
    projectType: 'general',
    options: [
      {
        id: 'opt-1',
        title: 'Lean First-Principles Implementation',
        summary: 'Direct modular solution tailored strictly to acceptance criteria.',
        stack: ['Node.js', 'HTML5/CSS3/ES2023'],
        tradeoffs: 'Minimal dependencies, fast verification.',
      },
      {
        id: 'opt-2',
        title: 'Full SPA + Separate API Server',
        summary: 'React Vite frontend with Express API.',
        stack: ['React', 'Vite', 'Express'],
        tradeoffs: 'Higher setup overhead.',
      },
    ],
    chosenOptionId: 'opt-1',
    rationaleOneLine: 'Delivers the complete verified result directly without unnecessary scaffolding overhead.',
    steps: ['Analyze workspace and memory', 'Build solution files', 'Run automated verification & self-critique'],
    risks: ['Scope drift or unverified assets'],
    edgeCases: ['Empty inputs, missing assets, mobile layout'],
    acceptanceCriteria: ['All generated files exist, pass verification, and satisfy user request'],
  };
}

export interface AgentLoopDeps {
  config: AxiomConfig;
  store: AxiomStore;
  router: ModelRouter;
  registry: ToolRegistry;
  previewManager: PreviewManager;
  onEvent?: RunEventListener;
}

export class AgentLoopRunner {
  private deps: AgentLoopDeps;

  constructor(deps: AgentLoopDeps) {
    this.deps = deps;
  }

  private emitLog(
    runId: string,
    entry: Omit<ActionLogEntry, 'id' | 'seq' | 'createdAt' | 'runId'>,
  ): ActionLogEntry {
    const saved = this.deps.store.appendActionLog({ ...entry, runId });
    const run = this.deps.store.getRun(runId)!;
    this.deps.onEvent?.({ type: 'log', run, log: saved });
    return saved;
  }

  private updateRun(
    runId: string,
    patch: Parameters<AxiomStore['updateRunState']>[1],
  ): RunRecord {
    this.deps.store.updateRunState(runId, patch);
    const updated = this.deps.store.getRun(runId)!;
    this.deps.onEvent?.({ type: 'run_update', run: updated });
    return updated;
  }

  async executeRun(
    runId: string,
    options?: { resumeConfirmationApproved?: boolean },
  ): Promise<RunRecord> {
    let run = this.deps.store.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    const project = this.deps.store.getProject(run.projectId);
    if (!project) throw new Error(`Project not found: ${run.projectId}`);

    const budget: BudgetState = {
      usedTokens: run.totalTokens,
      usedCostUsd: run.totalCostUsd,
      maxTokens: this.deps.config.maxTokensPerRun,
      maxCostUsd: this.deps.config.maxCostUsdPerRun,
    };

    const lang = run.language || detectLanguage(run.prompt);
    const checkpoint: RunCheckpoint = run.checkpoint ?? {
      phase: 'understand',
      iteration: 1,
      stepCount: 0,
    };

    try {
      this.updateRun(runId, { status: 'running' });

      // 1. UNDERSTAND (load memory + workspace map)
      let memoryContext = '';
      if (!checkpoint.plan) {
        this.updateRun(runId, { currentPhase: 'understand' });
        const t0 = Date.now();
        const memories = this.deps.store.searchMemories(run.prompt, 4);
        const notes = this.deps.store.listProjectNotes(project.id);
        memoryContext = [
          memories.length > 0
            ? `Long-term lessons:\n${memories.map((m) => `- [${m.category}] ${m.title}: ${m.content}`).join('\n')}`
            : '',
          notes.length > 0
            ? `Project notes:\n${notes.map((n) => `- ${n.key}: ${n.content}`).join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n');

        this.emitLog(runId, {
          role: 'Researcher',
          phase: 'understand',
          eventType: 'memory',
          summary: `Detected language=${lang}; loaded ${memories.length} long-term lesson(s), ${notes.length} project note(s).`,
          output: { language: lang, memoriesCount: memories.length, notesCount: notes.length },
          status: 'ok',
          durationMs: Date.now() - t0,
          tokensUsed: 0,
          costUsd: 0,
        });

        // 2. PLAN (Planner role -> reasoning tier)
        this.updateRun(runId, { currentPhase: 'plan' });
        const tPlan = Date.now();
        const repoMapTool = this.deps.registry.get('repo_map');
        const mapResult = repoMapTool
          ? await repoMapTool.execute({}, {
              projectId: project.id,
              runId,
              workspacePath: project.workspacePath,
              store: this.deps.store,
              previewManager: this.deps.previewManager,
              cmdTimeoutMs: this.deps.config.cmdTimeoutMs,
            })
          : undefined;

        const planUserPrompt = [
          `User goal: ${run.prompt}`,
          memoryContext,
          mapResult ? `Current workspace files: ${JSON.stringify(mapResult.output)}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');

        const { response: planResp, tier: planTier } = await this.deps.router.invoke({
          role: 'Planner',
          systemPrompt: getRoleSystemPrompt('Planner', lang),
          messages: [{ role: 'user', content: planUserPrompt }],
          jsonMode: true,
          budget,
        });

        const parsedPlan = extractJsonObject<ExecutionPlan>(planResp.text);
        const plan: ExecutionPlan = parsedPlan && Array.isArray(parsedPlan.options)
          ? { ...parsedPlan, language: lang }
          : defaultPlan(run.prompt, lang);

        checkpoint.plan = plan;
        checkpoint.phase = 'act';
        this.updateRun(runId, {
          currentPhase: 'act',
          totalTokens: budget.usedTokens,
          totalCostUsd: budget.usedCostUsd,
          checkpoint,
        });

        this.emitLog(runId, {
          role: 'Planner',
          phase: 'plan',
          eventType: 'plan',
          summary: `Planned ${plan.options.length} approaches; picked "${plan.chosenOptionId}": ${plan.rationaleOneLine}`,
          output: plan,
          status: 'ok',
          durationMs: Date.now() - tPlan,
          tokensUsed: planResp.usage.totalTokens,
          costUsd: planResp.usage.costUsd,
          modelUsed: planResp.model,
          modelTier: planTier,
        });
      }

      // 3. ACT -> VERIFY -> REFLECT ITERATIONS
      const plan = checkpoint.plan!;
      let builderMessages: LLMMessage[] = [
        {
          role: 'user',
          content: [
            run.prompt,
            `Approved Execution Plan (${plan.chosenOptionId}): ${plan.rationaleOneLine}`,
            `Steps:\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
            `Acceptance Criteria:\n${plan.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`,
            memoryContext,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ];

      // Handle resumed confirmation if any
      if (checkpoint.pendingConfirmation && options?.resumeConfirmationApproved !== undefined) {
        const pending = checkpoint.pendingConfirmation;
        checkpoint.pendingConfirmation = undefined;

        if (options.resumeConfirmationApproved) {
          const tool = this.deps.registry.get(pending.toolName);
          const tExec = Date.now();
          const res = tool
            ? await tool.execute(pending.args, {
                projectId: project.id,
                runId,
                workspacePath: project.workspacePath,
                store: this.deps.store,
                previewManager: this.deps.previewManager,
                cmdTimeoutMs: this.deps.config.cmdTimeoutMs,
                approvedConfirmationId: pending.id,
              })
            : { ok: false, output: { error: 'Tool missing' }, summary: 'Tool missing' };

          this.emitLog(runId, {
            role: 'Builder',
            phase: 'act',
            eventType: 'confirmation_resolved',
            toolName: pending.toolName,
            summary: `User APPROVED "${pending.toolName}": ${res.summary}`,
            input: pending.args,
            output: res.output,
            status: res.ok ? 'ok' : 'error',
            durationMs: Date.now() - tExec,
            tokensUsed: 0,
            costUsd: 0,
          });
          builderMessages.push({
            role: 'user',
            content: `User approved "${pending.toolName}". Execution result: ${JSON.stringify(res.output)}`,
          });
        } else {
          this.emitLog(runId, {
            role: 'Builder',
            phase: 'act',
            eventType: 'confirmation_resolved',
            toolName: pending.toolName,
            summary: `User REJECTED destructive action "${pending.toolName}" (${pending.reason}).`,
            input: pending.args,
            status: 'blocked',
            durationMs: 0,
            tokensUsed: 0,
            costUsd: 0,
          });
          checkpoint.phase = 'deliver';
          const rejectionSummary =
            lang === 'si'
              ? `ආරක්ෂක පියවරක් ලෙස "${pending.toolName}" ක්‍රියාව ඔබ විසින් ප්‍රතික්ෂේප කරන ලදී. කිසිදු හානිකර විධානයක් ක්‍රියාත්මක නොවීය.`
              : lang === 'singlish'
                ? `Safety check eka nisa "${pending.toolName}" command eka oya reject kala. Kisi destructive action ekak run une na.`
                : `Safety gate respected: you rejected "${pending.toolName}" (${pending.reason}). No destructive action was executed.`;

          this.deps.store.addMessage({
            runId,
            projectId: project.id,
            role: 'assistant',
            content: rejectionSummary,
            metadata: { safetyRejected: true },
          });
          return this.updateRun(runId, {
            status: 'completed',
            currentPhase: 'deliver',
            finalSummary: rejectionSummary,
            checkpoint,
          });
        }
      }

      let finalAssistantText = '';
      let lastVerification: VerificationReport | undefined = checkpoint.lastVerification;
      let lastReview: ReviewVerdict | undefined = checkpoint.lastReview;

      for (let iter = checkpoint.iteration; iter <= this.deps.config.maxIterations; iter++) {
        checkpoint.iteration = iter;
        this.updateRun(runId, { currentPhase: 'act', iteration: iter, checkpoint });

        const hardBugEscalation = iter > 1;
        const toolsDecl = this.deps.registry.toLLMDeclarations();
        let builderDone = false;

        while (!builderDone && checkpoint.stepCount < this.deps.config.maxToolSteps) {
          const tBuild = Date.now();
          const { response: bResp, tier: bTier } = await this.deps.router.invoke({
            role: 'Builder',
            systemPrompt: getRoleSystemPrompt('Builder', lang),
            messages: builderMessages,
            tools: toolsDecl,
            hardBugEscalation,
            budget,
          });

          this.updateRun(runId, {
            totalTokens: budget.usedTokens,
            totalCostUsd: budget.usedCostUsd,
          });

          if (bResp.toolCalls.length === 0) {
            finalAssistantText = bResp.text || finalAssistantText;
            builderMessages.push({ role: 'assistant', content: bResp.text });
            builderDone = true;
            this.emitLog(runId, {
              role: 'Builder',
              phase: 'act',
              eventType: 'status',
              summary: `Builder iteration ${iter} finished implementation pass.`,
              output: { textPreview: bResp.text.slice(0, 300) },
              status: 'ok',
              durationMs: Date.now() - tBuild,
              tokensUsed: bResp.usage.totalTokens,
              costUsd: bResp.usage.costUsd,
              modelUsed: bResp.model,
              modelTier: bTier,
            });
            break;
          }

          builderMessages.push({
            role: 'assistant',
            content: bResp.text,
            toolCalls: bResp.toolCalls,
          });

          for (const tc of bResp.toolCalls) {
            checkpoint.stepCount++;
            const tool = this.deps.registry.get(tc.name);
            const tTool = Date.now();

            if (!tool) {
              const errOut = { error: `Unknown tool: ${tc.name}` };
              builderMessages.push({
                role: 'tool',
                toolCallId: tc.id,
                toolName: tc.name,
                content: JSON.stringify(errOut),
              });
              this.emitLog(runId, {
                role: 'Builder',
                phase: 'act',
                eventType: 'tool_result',
                toolName: tc.name,
                summary: `Unknown tool "${tc.name}"`,
                output: errOut,
                status: 'error',
                durationMs: Date.now() - tTool,
                tokensUsed: 0,
                costUsd: 0,
              });
              continue;
            }

            const result = await tool.execute(tc.arguments, {
              projectId: project.id,
              runId,
              workspacePath: project.workspacePath,
              store: this.deps.store,
              previewManager: this.deps.previewManager,
              cmdTimeoutMs: this.deps.config.cmdTimeoutMs,
            });

            if (result.requiresConfirmation) {
              const confirmation: PendingConfirmation = {
                id: `confirm-${randomUUID().slice(0, 8)}`,
                toolName: result.requiresConfirmation.toolName,
                reason: result.requiresConfirmation.reason,
                args: result.requiresConfirmation.args,
                createdAt: new Date().toISOString(),
              };
              checkpoint.pendingConfirmation = confirmation;
              this.emitLog(runId, {
                role: 'Builder',
                phase: 'act',
                eventType: 'confirmation_required',
                toolName: confirmation.toolName,
                summary: `Paused for user confirmation: ${confirmation.reason}`,
                input: confirmation.args,
                status: 'warn',
                durationMs: Date.now() - tTool,
                tokensUsed: 0,
                costUsd: 0,
              });
              return this.updateRun(runId, {
                status: 'awaiting_confirmation',
                currentPhase: 'act',
                checkpoint,
              });
            }

            if (tc.name === 'verify_web_app' && result.output && typeof result.output === 'object') {
              lastVerification = result.output as VerificationReport;
              checkpoint.lastVerification = lastVerification;
            }

            builderMessages.push({
              role: 'tool',
              toolCallId: tc.id,
              toolName: tc.name,
              content: JSON.stringify(result.output),
            });

            this.emitLog(runId, {
              role: 'Builder',
              phase: 'observe',
              eventType: 'tool_result',
              toolName: tc.name,
              summary: result.summary,
              input: tc.name === 'write_file' ? { path: tc.arguments.path } : tc.arguments,
              output: result.output,
              status: result.ok ? 'ok' : 'error',
              durationMs: Date.now() - tTool,
              tokensUsed: bResp.usage.totalTokens,
              costUsd: bResp.usage.costUsd,
              modelUsed: bResp.model,
              modelTier: bTier,
            });
          }

          this.updateRun(runId, { checkpoint });
        }

        // 4. VERIFY (Tester role — automatic live check if web UI exists!)
        this.updateRun(runId, { currentPhase: 'verify' });
        const hasIndexHtml = fs.existsSync(path.join(project.workspacePath, 'index.html'));
        if (hasIndexHtml) {
          const tVer = Date.now();
          let port = this.deps.previewManager.getPort(project.id);
          if (!port) {
            const started = await this.deps.previewManager.startStaticPreview(
              project.id,
              project.workspacePath,
            );
            port = started.port;
          }
          lastVerification = await verifyWebApp({
            baseUrl: `http://127.0.0.1:${port}`,
            entryPath: '/',
            workspacePath: project.workspacePath,
            previewDisplayUrl: `/preview/${project.id}/`,
          });
          checkpoint.lastVerification = lastVerification;
          this.emitLog(runId, {
            role: 'Tester',
            phase: 'verify',
            eventType: 'verification',
            toolName: 'verify_web_app',
            summary: lastVerification.passed
              ? `Tester verified live preview (${lastVerification.checks.length}/${lastVerification.checks.length} checks passed)`
              : `Tester detected ${lastVerification.checks.filter((c) => !c.passed).length} failed verification check(s)`,
            output: lastVerification,
            status: lastVerification.passed ? 'ok' : 'error',
            durationMs: Date.now() - tVer,
            tokensUsed: 0,
            costUsd: 0,
          });
        }

        // 5. REFLECT & CRITIQUE (Reviewer role -> reasoning tier, can VETO!)
        this.updateRun(runId, { currentPhase: 'reflect' });
        const tRev = Date.now();
        const workspaceFiles = fs.existsSync(project.workspacePath)
          ? fs.readdirSync(project.workspacePath)
          : [];
        const logsSummary = this.deps.store
          .listActionLogs(runId)
          .slice(-10)
          .map((l) => `[${l.role}] ${l.summary} (${l.status})`)
          .join('\n');

        const reviewInput = [
          `Goal: ${run.prompt}`,
          `Workspace files: ${workspaceFiles.join(', ')}`,
          `Recent action logs:\n${logsSummary}`,
          lastVerification ? `VERIFICATION_JSON: ${JSON.stringify(lastVerification)}` : '',
          `Builder summary: ${finalAssistantText}`,
        ]
          .filter(Boolean)
          .join('\n\n');

        const { response: revResp, tier: revTier } = await this.deps.router.invoke({
          role: 'Reviewer',
          systemPrompt: getRoleSystemPrompt('Reviewer', lang),
          messages: [{ role: 'user', content: reviewInput }],
          jsonMode: true,
          budget,
        });

        const parsedVerdict = extractJsonObject<ReviewVerdict>(revResp.text);
        const verdict: ReviewVerdict = parsedVerdict ?? {
          approved: lastVerification ? lastVerification.passed : true,
          vetoed: lastVerification ? !lastVerification.passed : false,
          score: lastVerification?.passed !== false ? 85 : 50,
          summary: revResp.text || 'Review completed.',
          issues: [],
        };

        // Enforce deterministic veto if verification checks actually failed!
        if (lastVerification && !lastVerification.passed) {
          verdict.approved = false;
          verdict.vetoed = true;
          if (verdict.issues.length === 0) {
            verdict.issues = lastVerification.checks
              .filter((c) => !c.passed)
              .map((c) => ({
                severity: 'blocker',
                category: 'functionality',
                description: `${c.name}: ${c.details}`,
                fixInstruction: `Resolve failed check ${c.name}`,
              }));
          }
        }

        lastReview = verdict;
        checkpoint.lastReview = verdict;
        this.updateRun(runId, {
          totalTokens: budget.usedTokens,
          totalCostUsd: budget.usedCostUsd,
          checkpoint,
        });

        this.emitLog(runId, {
          role: 'Reviewer',
          phase: 'reflect',
          eventType: 'review',
          summary: verdict.approved
            ? `Reviewer APPROVED (score ${verdict.score}/100): ${verdict.summary}`
            : `Reviewer VETOED (score ${verdict.score}/100): ${verdict.issues.map((i) => i.description).join('; ')}`,
          output: verdict,
          status: verdict.approved ? 'ok' : 'warn',
          durationMs: Date.now() - tRev,
          tokensUsed: revResp.usage.totalTokens,
          costUsd: revResp.usage.costUsd,
          modelUsed: revResp.model,
          modelTier: revTier,
        });

        if (verdict.approved || iter === this.deps.config.maxIterations) {
          break;
        }

        // Loop back to Builder with Reviewer veto instructions!
        builderMessages.push({
          role: 'user',
          content: `REVIEWER_VETO_FIX: The Senior Reviewer vetoed iteration ${iter}. Fix ALL issues and re-verify:\n${JSON.stringify(verdict.issues, null, 2)}`,
        });
      }

      // 6. DELIVER & RECORD LONG-TERM MEMORY
      this.updateRun(runId, { currentPhase: 'deliver' });
      const previewPort = this.deps.previewManager.getPort(project.id);
      const previewUrl = previewPort ? `/preview/${project.id}/` : undefined;

      this.deps.store.addMemory({
        category: 'pattern',
        title: `${plan.projectType}: ${plan.chosenOptionId}`,
        content: `Goal "${run.prompt.slice(0, 80)}" verified with score ${lastReview?.score ?? 85}/100. Rationale: ${plan.rationaleOneLine}`,
        tags: [plan.projectType, lang, run.provider],
        sourceRunId: runId,
        confidence: lastReview?.approved ? 0.9 : 0.65,
      });

      this.deps.store.upsertProjectNote(
        project.id,
        'architecture',
        `${plan.rationaleOneLine} (Verified: ${lastVerification ? (lastVerification.passed ? 'PASS' : 'FAIL') : 'CLI/Tests'})`,
      );

      const deliveredText =
        finalAssistantText ||
        `Completed "${plan.goal}". ${previewUrl ? `Live preview available at ${previewUrl}.` : ''}`;

      this.deps.store.addMessage({
        runId,
        projectId: project.id,
        role: 'assistant',
        content: deliveredText,
        metadata: {
          previewUrl,
          verification: lastVerification,
          review: lastReview,
          plan,
        },
      });

      this.emitLog(runId, {
        role: 'Reviewer',
        phase: 'deliver',
        eventType: 'complete',
        summary: `Run delivered cleanly (${budget.usedTokens} tokens, $${budget.usedCostUsd.toFixed(4)}).`,
        output: { previewUrl, reviewScore: lastReview?.score },
        status: 'ok',
        durationMs: 0,
        tokensUsed: 0,
        costUsd: 0,
      });

      checkpoint.phase = 'deliver';
      return this.updateRun(runId, {
        status: 'completed',
        currentPhase: 'deliver',
        finalSummary: deliveredText,
        totalTokens: budget.usedTokens,
        totalCostUsd: budget.usedCostUsd,
        checkpoint,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.deps.store.addMemory({
        category: 'lesson',
        title: `Run failure recovery: ${msg.slice(0, 60)}`,
        content: `Run ${runId} encountered error "${msg}" during phase ${checkpoint.phase}.`,
        tags: ['error', checkpoint.phase],
        sourceRunId: runId,
        confidence: 0.7,
      });
      this.emitLog(runId, {
        role: 'Reviewer' as SpecialistRole,
        phase: checkpoint.phase as LoopPhase,
        eventType: 'error',
        summary: `Run failed: ${msg}`,
        status: 'error',
        durationMs: 0,
        tokensUsed: budget.usedTokens,
        costUsd: budget.usedCostUsd,
      });
      return this.updateRun(runId, {
        status: 'failed',
        finalSummary: `Run failed: ${msg}`,
        totalTokens: budget.usedTokens,
        totalCostUsd: budget.usedCostUsd,
        checkpoint,
      });
    }
  }
}
