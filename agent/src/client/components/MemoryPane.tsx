import { useState, type FormEvent } from 'react';
import { BookOpen, Plus } from 'lucide-react';
import type { MemoryItem, ProjectNote } from '../../shared/types.ts';

interface MemoryPaneProps {
  memories: MemoryItem[];
  projectNotes: ProjectNote[];
  onAddMemory: (input: {
    category: MemoryItem['category'];
    title: string;
    content: string;
  }) => Promise<void>;
}

export function MemoryPane({ memories, projectNotes, onAddMemory }: MemoryPaneProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<MemoryItem['category']>('preference');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    await onAddMemory({ category, title: title.trim(), content: content.trim() });
    setTitle('');
    setContent('');
  };

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <form className="status-card" onSubmit={submit}>
        <div className="section-label">Teach Axiom a Preference or Lesson</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as MemoryItem['category'])}
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px' }}
          >
            <option value="preference">Preference</option>
            <option value="lesson">Lesson</option>
            <option value="pattern">Pattern</option>
            <option value="architecture">Architecture</option>
          </select>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short title (e.g. Prefer dark UI by default)"
            style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Rule or finding..."
            style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px' }}
          />
          <button type="submit" className="btn btn-primary">
            <Plus size={13} /> Save
          </button>
        </div>
      </form>

      {projectNotes.length > 0 && (
        <div className="status-card">
          <div className="section-label">Active Project Notes</div>
          {projectNotes.map((n) => (
            <div key={n.id} style={{ fontSize: 12.5 }}>
              <strong>{n.key}:</strong> <span className="muted">{n.content}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="section-label">
          <BookOpen size={12} style={{ verticalAlign: 'middle', marginRight: 5 }} />
          Long-Term Memory Store ({memories.length})
        </div>
        {memories.length === 0 ? (
          <div className="muted" style={{ fontSize: 12.5 }}>
            No long-term lessons recorded yet. Axiom records patterns and failure lessons automatically after every run.
          </div>
        ) : (
          memories.map((m) => (
            <div key={m.id} className="status-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{m.title}</strong>
                <span className="pill">{m.category} · hits: {m.hits}</span>
              </div>
              <div className="muted" style={{ fontSize: 12.5 }}>{m.content}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
