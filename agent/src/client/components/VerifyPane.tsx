import { CheckCircle2, XCircle, ShieldCheck } from 'lucide-react';
import type { RunRecord } from '../../shared/types.ts';

interface VerifyPaneProps {
  run?: RunRecord;
}

export function VerifyPane({ run }: VerifyPaneProps) {
  const verification = run?.checkpoint?.lastVerification;
  const review = run?.checkpoint?.lastReview;

  if (!verification && !review) {
    return (
      <div style={{ padding: 24 }} className="muted">
        Run a build task to see automated verification assertions and the Senior Reviewer's critique.
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {review && (
        <div className="status-card" style={{ gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>
              <ShieldCheck size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Senior Reviewer Critique
            </strong>
            <span className={`pill ${review.approved ? 'pill-live' : 'pill-demo'}`}>
              {review.approved ? 'APPROVED' : 'VETOED'} · {review.score}/100
            </span>
          </div>
          <div>{review.summary}</div>
          {review.issues.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {review.issues.map((issue, idx) => (
                <li key={idx} style={{ marginBottom: 4 }}>
                  <strong>[{issue.severity}]</strong> {issue.description} —{' '}
                  <span className="muted">{issue.fixInstruction}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {verification && (
        <div className="status-card" style={{ gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Automated Verification Matrix</strong>
            <span className={`pill ${verification.passed ? 'pill-live' : 'pill-demo'}`}>
              {verification.passed ? 'ALL PASSED' : 'ISSUES FOUND'}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {verification.browserNote}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {verification.checks.map((chk, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {chk.passed ? (
                    <CheckCircle2 size={14} color="#10b981" />
                  ) : (
                    <XCircle size={14} color="#ef4444" />
                  )}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 12.5 }}>{chk.name}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {chk.details}
                    </div>
                  </div>
                </div>
                <span className="pill">{chk.category}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
