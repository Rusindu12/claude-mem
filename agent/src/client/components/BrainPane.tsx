import { useState, type FormEvent } from 'react';
import { Cpu, RefreshCw, Sparkles } from 'lucide-react';
import type { BrainClassification, BrainStatusInfo } from '../../shared/types.ts';

interface BrainPaneProps {
  brain?: BrainStatusInfo;
  onRetrain: () => Promise<void>;
  onClassify: (prompt: string) => Promise<BrainClassification>;
}

export function BrainPane({ brain, onRetrain, onClassify }: BrainPaneProps) {
  const [probe, setProbe] = useState('GTA style 3D city driving game with NPC traffic and minimap');
  const [result, setResult] = useState<BrainClassification | null>(null);
  const [training, setTraining] = useState(false);

  const handleTrain = async () => {
    setTraining(true);
    try {
      await onRetrain();
    } finally {
      setTraining(false);
    }
  };

  const handleProbe = async (e: FormEvent) => {
    e.preventDefault();
    if (!probe.trim()) return;
    setResult(await onClassify(probe.trim()));
  };

  if (!brain) {
    return (
      <div style={{ padding: 24 }} className="muted">
        Loading neural brain telemetry...
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="status-card" style={{ gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>
              <Cpu size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              {brain.engineName}
            </strong>
            <div className="muted" style={{ fontSize: 12 }}>
              Self-contained Neural Classifier + Compositional Code Architect (zero external keys needed)
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={training}
            onClick={() => void handleTrain()}
          >
            <RefreshCw size={13} />
            {training ? 'Training...' : 'Retrain Brain'}
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: 8,
            paddingTop: 6,
          }}
        >
          <div className="plan-option">
            <div className="muted">Architecture</div>
            <strong>
              {brain.vocabDims} → {brain.hiddenUnits} → {brain.intents.length}
            </strong>
          </div>
          <div className="plan-option">
            <div className="muted">Train Accuracy</div>
            <strong>{Math.round(brain.trainAccuracy * 100)}%</strong>
          </div>
          <div className="plan-option">
            <div className="muted">Cross-Entropy Loss</div>
            <strong>{brain.lastLoss}</strong>
          </div>
          <div className="plan-option">
            <div className="muted">Samples / Online Updates</div>
            <strong>
              {brain.trainingSamples} / +{brain.onlineUpdates}
            </strong>
          </div>
        </div>
      </div>

      <form className="status-card" onSubmit={handleProbe}>
        <div className="section-label">
          <Sparkles size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          Test Live Neural Intent &amp; Entity Parser (English / Singlish / Sinhala)
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={probe}
            onChange={(e) => setProbe(e.target.value)}
            placeholder="Type any prompt to inspect neural probabilities..."
            style={{
              flex: 1,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '7px 10px',
            }}
          />
          <button type="submit" className="btn">
            Classify
          </button>
        </div>

        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            <div style={{ fontSize: 12.5 }}>
              Predicted: <strong>{result.intent}</strong> ({Math.round(result.confidence * 100)}%) ·
              Lang: <strong>{result.language}</strong> · Domain: <strong>{result.domain}</strong> ·
              Brand: <strong>{result.brand}</strong>
            </div>
            {result.topIntents.map((ti) => (
              <div key={ti.intent} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ width: 150 }}>{ti.intent}</span>
                <div
                  style={{
                    flex: 1,
                    height: 8,
                    background: 'var(--bg)',
                    borderRadius: 999,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(2, Math.round(ti.confidence * 100))}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, var(--accent), var(--accent-2))',
                    }}
                  />
                </div>
                <span style={{ width: 42, textAlign: 'right' }}>
                  {Math.round(ti.confidence * 100)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}
