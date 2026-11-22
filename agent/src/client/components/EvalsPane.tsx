import { Play, CheckCircle2, XCircle, Activity } from 'lucide-react';
import type { EvalRunRecord } from '../../shared/types.ts';

interface EvalsPaneProps {
  evalRuns: EvalRunRecord[];
  isRunningEval: boolean;
  onRunEval: () => Promise<void>;
}

export function EvalsPane({ evalRuns, isRunningEval, onRunEval }: EvalsPaneProps) {
  const latest = evalRuns[0];

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="status-card" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>
            <Activity size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Benchmark Eval Suite v1
          </strong>
          <div className="muted" style={{ fontSize: 12 }}>
            Landing Page, CRUD App, 2D Game, API Service, Singlish, Injection Defense &amp; Safety Gate
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={isRunningEval}
          onClick={() => void onRunEval()}
        >
          <Play size={13} />
          {isRunningEval ? 'Running Suite...' : 'Run Eval Suite'}
        </button>
      </div>

      {latest && (
        <div className="status-card" style={{ gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>
              Latest Run ({latest.suiteVersion} · {latest.provider})
            </strong>
            <span className={`pill ${latest.failed === 0 ? 'pill-live' : 'pill-demo'}`}>
              {latest.passed}/{latest.totalTasks} PASSED · {latest.totalDurationMs}ms
            </span>
          </div>
          {latest.regressions.length > 0 && (
            <div style={{ color: '#fca5a5', fontSize: 12 }}>
              Regressions detected: {latest.regressions.join(', ')}
            </div>
          )}
          {latest.improvements.length > 0 && (
            <div style={{ color: '#6ee7b7', fontSize: 12 }}>
              Improvements: {latest.improvements.join(', ')}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {latest.results.map((r) => (
              <div
                key={r.id}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                    {r.passed ? (
                      <CheckCircle2 size={14} color="#10b981" />
                    ) : (
                      <XCircle size={14} color="#ef4444" />
                    )}
                    {r.name}
                  </span>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {r.score}/100 · {r.durationMs}ms
                  </span>
                </div>
                {r.checks.map((c, idx) => (
                  <div key={idx} className="muted" style={{ fontSize: 11.5, paddingLeft: 20 }}>
                    {c.passed ? '✓' : '✗'} {c.name}: {c.details}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {evalRuns.length > 1 && (
        <div className="status-card">
          <div className="section-label">Eval History ({evalRuns.length})</div>
          {evalRuns.slice(1).map((er) => (
            <div key={er.id} className="muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span>{er.createdAt.slice(0, 19).replace('T', ' ')} ({er.provider})</span>
              <span>{er.passed}/{er.totalTasks} passed ({er.totalDurationMs}ms)</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
