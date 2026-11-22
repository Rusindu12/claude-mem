import { CheckCircle2, AlertTriangle, XCircle, Wrench, Brain } from 'lucide-react';
import type { ActionLogEntry, ExecutionPlan, RunRecord } from '../../shared/types.ts';

interface RunTraceProps {
  run?: RunRecord;
  logs: ActionLogEntry[];
}

export function RunTrace({ run, logs }: RunTraceProps) {
  if (!run && logs.length === 0) return null;

  const planLog = logs.find((l) => l.eventType === 'plan');
  const plan = (planLog?.output ?? run?.checkpoint?.plan) as ExecutionPlan | undefined;

  return (
    <div className="trace-box" aria-label="Autonomous agent execution trace">
      <div className="trace-head">
        <strong>
          <Brain size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Autonomous Loop Trace
        </strong>
        {run && (
          <span className="muted" style={{ fontSize: '11px' }}>
            phase: <strong>{run.currentPhase}</strong> &middot; iter {run.iteration} &middot;{' '}
            {run.totalTokens} tok &middot; ${run.totalCostUsd.toFixed(4)}
          </span>
        )}
      </div>

      {plan && (
        <div
          style={{
            background: 'rgba(99, 102, 241, 0.06)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            borderRadius: 10,
            padding: 10,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600 }}>
            First-Principles Decision: {plan.rationaleOneLine}
          </div>
          <div className="plan-options">
            {plan.options.map((opt) => (
              <div
                key={opt.id}
                className={`plan-option ${opt.id === plan.chosenOptionId ? 'chosen' : ''}`}
              >
                <div style={{ fontWeight: 600 }}>
                  {opt.id === plan.chosenOptionId ? '✓ ' : ''}
                  {opt.title}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {opt.stack.join(' · ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {logs.map((log) => (
        <div key={log.id} className={`trace-item ${log.status}`}>
          <div className="trace-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span className="pill pill-role">{log.role}</span>
              {log.toolName && (
                <span className="pill">
                  <Wrench size={10} />
                  {log.toolName}
                </span>
              )}
              {log.modelTier && (
                <span className="muted" style={{ fontSize: 11 }}>
                  [{log.modelTier}]
                </span>
              )}
            </div>
            <span className="muted" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {log.status === 'ok' && <CheckCircle2 size={12} color="#10b981" />}
              {log.status === 'warn' && <AlertTriangle size={12} color="#f59e0b" />}
              {(log.status === 'error' || log.status === 'blocked') && (
                <XCircle size={12} color="#ef4444" />
              )}
              {log.durationMs}ms
            </span>
          </div>
          <div style={{ fontSize: 12.5 }}>{log.summary}</div>
        </div>
      ))}
    </div>
  );
}
