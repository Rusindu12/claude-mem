import { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import type { ProjectRecord } from '../../shared/types.ts';
import { apiUrl, isStandaloneLocalMode } from '../api.ts';
import { buildLocalPreviewDocument } from '../local-runtime.ts';

interface PreviewPaneProps {
  project?: ProjectRecord;
  hasHtml: boolean;
  reloadKey: number;
}

export function PreviewPane({ project, hasHtml, reloadKey }: PreviewPaneProps) {
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [manualNonce, setManualNonce] = useState(0);
  const standalone = isStandaloneLocalMode();

  const localDoc = useMemo(() => {
    if (!standalone || !project || !hasHtml) return null;
    return buildLocalPreviewDocument(project.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standalone, project?.id, hasHtml, reloadKey, manualNonce]);

  useEffect(() => {
    return () => {
      localDoc?.cleanup();
    };
  }, [localDoc]);

  if (!project || !hasHtml) {
    return (
      <div style={{ padding: 24 }} className="muted">
        <h3 style={{ marginTop: 0, color: 'var(--text)' }}>Live Preview</h3>
        <p>
          Build a web project (e.g. type <code>make me a landing page</code>) to boot a live
          preview server and render it right here.
        </p>
      </div>
    );
  }

  const previewUrl = apiUrl(`/preview/${encodeURIComponent(project.id)}/`);
  const zipUrl = apiUrl(`/api/projects/${encodeURIComponent(project.id)}/download`);
  const frameWidth = viewport === 'mobile' ? '375px' : viewport === 'tablet' ? '768px' : '100%';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="preview-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className={`btn ${viewport === 'desktop' ? 'btn-primary' : ''}`}
            onClick={() => setViewport('desktop')}
            title="Desktop view"
          >
            <Monitor size={13} />
          </button>
          <button
            type="button"
            className={`btn ${viewport === 'tablet' ? 'btn-primary' : ''}`}
            onClick={() => setViewport('tablet')}
            title="Tablet view (768px)"
          >
            <Tablet size={13} />
          </button>
          <button
            type="button"
            className={`btn ${viewport === 'mobile' ? 'btn-primary' : ''}`}
            onClick={() => setViewport('mobile')}
            title="Mobile view (375px)"
          >
            <Smartphone size={13} />
          </button>
          <span className="muted" style={{ fontSize: 11.5, marginLeft: 4 }}>
            {standalone ? 'on-device://preview' : `/preview/${project.id}/`}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="btn"
            onClick={() => setManualNonce((n) => n + 1)}
            title="Reload preview"
          >
            <RefreshCw size={13} />
          </button>
          {!standalone && (
            <>
              <a
                href={zipUrl}
                download
                className="btn"
                style={{ textDecoration: 'none' }}
                title="Download built Web App (.zip)"
              >
                <Download size={13} />
                Web App ZIP
              </a>
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="btn"
                style={{ textDecoration: 'none' }}
              >
                <ExternalLink size={13} />
                Open
              </a>
            </>
          )}
        </div>
      </div>

      <div className="preview-stage">
        {standalone && localDoc ? (
          <iframe
            key={`${project.id}-${reloadKey}-${manualNonce}`}
            srcDoc={localDoc.html}
            title={`Live preview for ${project.name}`}
            className="preview-frame"
            style={{ width: frameWidth }}
          />
        ) : (
          <iframe
            key={`${project.id}-${reloadKey}-${manualNonce}`}
            src={previewUrl}
            title={`Live preview for ${project.name}`}
            className="preview-frame"
            style={{ width: frameWidth }}
          />
        )}
      </div>
    </div>
  );
}
