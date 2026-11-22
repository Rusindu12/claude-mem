export type LanguageCode = 'en' | 'si' | 'singlish';

export type SpecialistRole =
  | 'Planner'
  | 'Builder'
  | 'Designer'
  | 'Tester'
  | 'Reviewer'
  | 'Researcher';

export type LoopPhase =
  | 'understand'
  | 'plan'
  | 'act'
  | 'observe'
  | 'verify'
  | 'reflect'
  | 'deliver';

export type ModelTier = 'reasoning' | 'fast';

export type ProviderKind = 'axiom-native' | 'anthropic' | 'openai' | 'gemini' | 'local' | 'demo';

export type RunStatus =
  | 'running'
  | 'awaiting_confirmation'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ApproachOption {
  id: string;
  title: string;
  summary: string;
  stack: string[];
  tradeoffs: string;
}

export interface ExecutionPlan {
  goal: string;
  language: LanguageCode;
  projectType: 'landing_page' | 'crud_app' | 'game_2d' | 'api_service' | 'fullstack' | 'general';
  options: ApproachOption[];
  chosenOptionId: string;
  rationaleOneLine: string;
  steps: string[];
  risks: string[];
  edgeCases: string[];
  acceptanceCriteria: string[];
}

export interface ReviewIssue {
  severity: 'blocker' | 'major' | 'minor';
  category: 'functionality' | 'security' | 'ux' | 'performance' | 'code_quality' | 'honesty';
  description: string;
  fixInstruction: string;
}

export interface ReviewVerdict {
  approved: boolean;
  vetoed: boolean;
  score: number;
  summary: string;
  issues: ReviewIssue[];
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  details: string;
  category: 'http' | 'assets' | 'dom' | 'a11y' | 'syntax' | 'tests' | 'browser';
}

export interface VerificationReport {
  passed: boolean;
  previewUrl?: string;
  httpStatus?: number;
  browserChecked: boolean;
  browserNote: string;
  checks: VerificationCheck[];
  timestamp: string;
}

export interface PendingConfirmation {
  id: string;
  toolName: string;
  reason: string;
  args: Record<string, unknown>;
  createdAt: string;
}

export interface RunCheckpoint {
  phase: LoopPhase;
  iteration: number;
  stepCount: number;
  plan?: ExecutionPlan;
  lastVerification?: VerificationReport;
  lastReview?: ReviewVerdict;
  pendingConfirmation?: PendingConfirmation;
  conversationState?: Array<{ role: string; content: string; toolName?: string }>;
}

export interface ActionLogEntry {
  id: string;
  runId: string;
  seq: number;
  role: SpecialistRole;
  phase: LoopPhase;
  eventType:
    | 'status'
    | 'plan'
    | 'tool_call'
    | 'tool_result'
    | 'verification'
    | 'review'
    | 'confirmation_required'
    | 'confirmation_resolved'
    | 'memory'
    | 'error'
    | 'complete';
  toolName?: string;
  summary: string;
  input?: unknown;
  output?: unknown;
  status: 'ok' | 'warn' | 'error' | 'blocked';
  durationMs: number;
  tokensUsed: number;
  costUsd: number;
  modelUsed?: string;
  modelTier?: ModelTier;
  createdAt: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  workspacePath: string;
  previewPort?: number;
  previewStatus: 'stopped' | 'running' | 'error';
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  projectId: string;
  prompt: string;
  language: LanguageCode;
  status: RunStatus;
  provider: ProviderKind;
  isOfflineDemo: boolean;
  reasoningModel: string;
  fastModel: string;
  totalTokens: number;
  totalCostUsd: number;
  currentPhase: LoopPhase;
  iteration: number;
  finalSummary?: string;
  checkpoint?: RunCheckpoint;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageRecord {
  id: string;
  runId: string;
  projectId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface MemoryItem {
  id: string;
  category: 'lesson' | 'preference' | 'pattern' | 'architecture';
  title: string;
  content: string;
  tags: string[];
  sourceRunId?: string;
  confidence: number;
  hits: number;
  createdAt: string;
}

export interface ProjectNote {
  id: string;
  projectId: string;
  key: string;
  content: string;
  updatedAt: string;
}

export interface EvalCaseResult {
  id: string;
  name: string;
  category: string;
  passed: boolean;
  score: number;
  durationMs: number;
  checks: Array<{ name: string; passed: boolean; details: string }>;
  error?: string;
}

export interface EvalRunRecord {
  id: string;
  suiteVersion: string;
  provider: ProviderKind;
  totalTasks: number;
  passed: number;
  failed: number;
  totalDurationMs: number;
  results: EvalCaseResult[];
  regressions: string[];
  improvements: string[];
  createdAt: string;
}

export interface BrainClassification {
  intent: string;
  confidence: number;
  topIntents: Array<{ intent: string; confidence: number }>;
  language: LanguageCode;
  brand: string;
  domain: string;
}

export interface BrainStatusInfo {
  engineName: string;
  version: string;
  vocabDims: number;
  hiddenUnits: number;
  intents: string[];
  trainingSamples: number;
  onlineUpdates: number;
  trainAccuracy: number;
  lastLoss: number;
  trainedAt: string;
}

export interface ProviderStatusInfo {
  activeProvider: ProviderKind;
  isOfflineDemo: boolean;
  reasoningModel: string;
  fastModel: string;
  configuredProviders: ProviderKind[];
  budgets: {
    maxIterations: number;
    maxToolSteps: number;
    maxTokensPerRun: number;
    maxCostUsdPerRun: number;
  };
}
