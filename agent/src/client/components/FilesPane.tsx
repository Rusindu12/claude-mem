import { useEffect, useState } from 'react';
import { Download, FileCode2 } from 'lucide-react';
import { apiUrl, fetchProjectFile, isStandaloneLocalMode } from '../api.ts';

interface FilesPaneProps {
  projectId?: string;
  files: Array<{ path: string; size: number }>;
}

export function FilesPane({ projectId, files }: FilesPaneProps) {
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [content, setContent] = useState<string>('');

  useEffect(() => {
    if (files.length === 0) {
      setSelectedPath('');
      setContent('');
      return;
    }
    const preferred = files.find((f) => f.path === 'index.html')?.path ?? files[0].path;
    if (!selectedPath || !files.some((f) => f.path === selectedPath)) {
      setSelectedPath(preferred);
    }
  }, [files, selectedPath]);

  useEffect(() => {
    if (!projectId || !selectedPath) return;
    let active = true;
    fetchProjectFile(projectId, selectedPath)
      .then((txt) => {
        if (active) setContent(txt);
      })
      .catch((err) => {
        if (active) setContent(`Error loading file: ${String(err)}`);
      });
    return () => {
      active = false;
    };
  }, [projectId, selectedPath, files]);

  if (!projectId || files.length === 0) {
    return (
      <div style={{ padding: 24 }} className="muted">
        No files generated in this workspace yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', height: '100%' }}>
      <div
        style={{
          borderRight: '1px solid var(--border)',
          padding: 10,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div className="section-label" style={{ marginBottom: 0 }}>Files ({files.length})</div>
          {!isStandaloneLocalMode() && (
            <a
              href={apiUrl(`/api/projects/${encodeURIComponent(projectId)}/download`)}
              download
              className="btn"
              style={{ padding: '4px 7px', fontSize: 11, textDecoration: 'none' }}
              title="Download workspace ZIP"
            >
              <Download size={11} />
              ZIP
            </a>
          )}
        </div>
        {files.map((f) => (
          <button
            key={f.path}
            type="button"
            className={`project-item ${f.path === selectedPath ? 'active' : ''}`}
            onClick={() => setSelectedPath(f.path)}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <FileCode2 size={12} />
              {f.path}
            </span>
            <span className="project-item-meta">{f.size} B</span>
          </button>
        ))}
      </div>

      <div style={{ padding: 12, overflow: 'auto' }}>
        <div className="section-label">{selectedPath}</div>
        <pre className="code-view">{content}</pre>
      </div>
    </div>
  );
}
