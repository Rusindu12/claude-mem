import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Send, ShieldAlert, Sparkles } from 'lucide-react';
import type {
  ActionLogEntry,
  ChatMessageRecord,
  ProjectRecord,
  RunRecord,
} from '../../shared/types.ts';
import { RunTrace } from './RunTrace.tsx';

interface ChatPanelProps {
  project?: ProjectRecord;
  messages: ChatMessageRecord[];
  activeRun?: RunRecord;
  logs: ActionLogEntry[];
  isBusy: boolean;
  onSubmitPrompt: (prompt: string) => void;
  onConfirmAction: (runId: string, approved: boolean) => void;
}

const DEMO_PROMPTS = [
  'make me a landing page',
  'make a GTA style 3D city driving game in Three.js with minimap and mission',
  'build a hospital patient appointment booking tracker with search and CSV export',
  'build a revenue analytics dashboard with interactive charts and CSV export',
  'build a mobile app ready for Android APK using Capacitor',
  'build a Node.js REST API service with health and notes endpoints',
  'mata coffee shop ekakata lassana landing page ekak hadanna',
];

export function ChatPanel({
  project,
  messages,
  activeRun,
  logs,
  isBusy,
  onSubmitPrompt,
  onConfirmAction,
}: ChatPanelProps) {
  const [input, setInput] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isBusy) return;
    setInput('');
    onSubmitPrompt(trimmed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || isBusy) return;
      setInput('');
      onSubmitPrompt(trimmed);
    }
  };

  const pendingConfirm =
    activeRun?.status === 'awaiting_confirmation'
      ? activeRun.checkpoint?.pendingConfirmation
      : undefined;

  return (
    <section className="chat-pane" aria-label="Agent chat and autonomous build loop">
      <div className="pane-topbar">
        <div>
          <strong>{project ? project.name : 'New Autonomous Build'}</strong>
          <div className="muted" style={{ fontSize: 11 }}>
            Understand &rarr; Plan (2-3 options) &rarr; Build &rarr; Verify &rarr; Critique &rarr; Deliver
          </div>
        </div>
        {activeRun && (
          <span
            className={`pill ${
              activeRun.status === 'completed'
                ? 'pill-live'
                : activeRun.status === 'awaiting_confirmation'
                  ? 'pill-demo'
                  : 'pill-role'
            }`}
          >
            {activeRun.status}
          </span>
        )}
      </div>

      <div className="chat-scroll">
        {messages.length === 0 && logs.length === 0 && (
          <div className="empty-hero">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={18} color="#818cf8" />
              <h2>First-Principles Autonomous Engineer</h2>
            </div>
            <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>
              Describe what you want to build in English, Singlish, or Sinhala. Axiom evaluates 2–3
              architectural approaches, builds inside a sandboxed workspace, runs real verification &amp;
              tests, self-critiques with Reviewer veto power, and opens a live preview.
            </p>
            <div className="chip-grid">
              {DEMO_PROMPTS.map((demo) => (
                <button
                  key={demo}
                  type="button"
                  className="demo-chip"
                  disabled={isBusy}
                  onClick={() => onSubmitPrompt(demo)}
                >
                  {demo}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`msg-card ${m.role === 'user' ? 'msg-user' : 'msg-assistant'}`}
          >
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
              {m.role === 'user' ? 'You' : 'Axiom'}
            </div>
            {m.content}
          </div>
        ))}

        {pendingConfirm && activeRun && (
          <div className="confirm-banner" role="alert">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <ShieldAlert size={16} color="#f59e0b" />
              Safety Confirmation Required ({pendingConfirm.toolName})
            </div>
            <div style={{ fontSize: 13 }}>{pendingConfirm.reason}</div>
            <pre className="code-view" style={{ fontSize: 11 }}>
              {JSON.stringify(pendingConfirm.args, null, 2)}
            </pre>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-success"
                onClick={() => onConfirmAction(activeRun.id, true)}
              >
                Approve &amp; Execute
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => onConfirmAction(activeRun.id, false)}
              >
                Reject Safely
              </button>
            </div>
          </div>
        )}

        {(activeRun || logs.length > 0) && <RunTrace run={activeRun} logs={logs} />}
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what to build (e.g. 'make me a landing page' or 'mata lassana app ekak hadanna')..."
          rows={2}
          disabled={isBusy}
          aria-label="Prompt input"
        />
        <button type="submit" className="btn btn-primary" disabled={isBusy || !input.trim()}>
          <Send size={14} />
          {isBusy ? 'Running...' : 'Build'}
        </button>
      </form>
    </section>
  );
}
