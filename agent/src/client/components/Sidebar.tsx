import { useEffect, useState } from 'react';
import {
  Cpu,
  Download,
  FolderPlus,
  Globe,
  Layers,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import type { ProjectRecord, ProviderStatusInfo } from '../../shared/types.ts';
import {
  apiUrl,
  getServerBase,
  isStandaloneLocalMode,
  setServerBase,
  type DownloadsStatus,
} from '../api.ts';

interface SidebarProps {
  projects: ProjectRecord[];
  activeProjectId?: string;
  providerStatus?: ProviderStatusInfo;
  toolsCount: number;
  downloadsStatus?: DownloadsStatus | null;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  onServerChange?: () => void;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function Sidebar({
  projects,
  activeProjectId,
  providerStatus,
  toolsCount,
  downloadsStatus,
  onSelectProject,
  onNewProject,
  onServerChange,
}: SidebarProps) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [remoteUrl, setRemoteUrl] = useState(() => getServerBase());
  const standalone = isStandaloneLocalMode();

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallPwa = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const handleApplyRemoteUrl = (e: React.FormEvent) => {
    e.preventDefault();
    setServerBase(remoteUrl);
    onServerChange?.();
  };

  const apkMb = downloadsStatus?.apk.sizeBytes
    ? `${(downloadsStatus.apk.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
    : null;

  return (
    <aside className="sidebar" aria-label="Projects and agent status">
      <div className="brand-header">
        <div className="brand-title">
          <span className="brand-dot" aria-hidden="true" />
          <span>AXIOM</span>
        </div>
        <button type="button" className="btn" onClick={onNewProject} title="Start fresh project">
          <FolderPlus size={14} />
          New
        </button>
      </div>

      {providerStatus && (
        <div className="status-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="section-label" style={{ marginBottom: 0 }}>
              {standalone ? 'On-Device AI' : 'LLM Router'}
            </span>
            <span className={`pill ${providerStatus.isOfflineDemo ? 'pill-demo' : 'pill-live'}`}>
              <Cpu size={11} />
              {providerStatus.activeProvider === 'axiom-native'
                ? 'Axiom Native AI'
                : providerStatus.isOfflineDemo
                  ? 'Offline Demo'
                  : providerStatus.activeProvider}
            </span>
          </div>
          <div className="muted" style={{ fontSize: '11px' }}>
            <div>Reasoning: {providerStatus.reasoningModel}</div>
            <div>Fast: {providerStatus.fastModel}</div>
          </div>
          <div
            className="muted"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '11px',
              paddingTop: '4px',
              borderTop: '1px solid var(--border)',
            }}
          >
            <span>
              <Layers size={11} style={{ verticalAlign: 'middle' }} /> {toolsCount} tools
            </span>
            <span>
              <ShieldCheck size={11} style={{ verticalAlign: 'middle' }} />{' '}
              {standalone ? 'Local APK' : 'Sandbox ON'}
            </span>
          </div>
        </div>
      )}

      {!standalone && downloadsStatus && (
        <div className="status-card" style={{ gap: 6 }}>
          <div className="section-label" style={{ marginBottom: 0 }}>
            Apps &amp; Downloads
          </div>
          {downloadsStatus.apk.ready ? (
            <a
              href={apiUrl('/api/downloads/apk')}
              download="axiom-studio.apk"
              className="btn btn-primary"
              style={{ textDecoration: 'none', justifyContent: 'space-between', fontSize: 12 }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Smartphone size={13} />
                Android APK
              </span>
              <span style={{ fontSize: 10.5, opacity: 0.9 }}>{apkMb ?? 'Download'}</span>
            </a>
          ) : (
            <div className="muted" style={{ fontSize: 11 }}>
              APK build via <code>npm run apk:build</code> or GitHub Actions.
            </div>
          )}
          {downloadsStatus.webApp.ready && (
            <a
              href={apiUrl('/api/downloads/webapp')}
              download="axiom-studio-webapp.zip"
              className="btn"
              style={{ textDecoration: 'none', justifyContent: 'space-between', fontSize: 12 }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Globe size={13} />
                Web App Bundle
              </span>
              <Download size={12} />
            </a>
          )}
          {installPrompt && (
            <button type="button" className="btn" onClick={() => void handleInstallPwa()}>
              <Download size={13} />
              Install PWA App
            </button>
          )}
        </div>
      )}

      {standalone && (
        <form onSubmit={handleApplyRemoteUrl} className="status-card" style={{ gap: 6 }}>
          <div className="section-label" style={{ marginBottom: 0 }}>
            Server Link (Optional)
          </div>
          <input
            type="url"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            placeholder="http://192.168.1.10:3000"
            className="input-field"
            style={{ fontSize: 11, padding: '6px 8px' }}
          />
          <button type="submit" className="btn" style={{ fontSize: 11 }}>
            Connect / Reset Local
          </button>
        </form>
      )}

      <div>
        <div className="section-label">Workspaces ({projects.length})</div>
      </div>

      <div className="project-list">
        {projects.length === 0 ? (
          <div className="muted" style={{ fontSize: '12px', padding: '6px' }}>
            No workspaces yet. Type a prompt to launch your first build.
          </div>
        ) : (
          projects.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`project-item ${p.id === activeProjectId ? 'active' : ''}`}
              onClick={() => onSelectProject(p.id)}
            >
              <span className="project-item-title">{p.name}</span>
              <span className="project-item-meta">
                {p.previewStatus === 'running' ? '● Live preview' : p.slug}
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
