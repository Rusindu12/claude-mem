import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, BookOpen, CheckSquare, Cpu, Eye, FileCode2 } from 'lucide-react';
import type {
  ActionLogEntry,
  BrainStatusInfo,
  ChatMessageRecord,
  EvalRunRecord,
  MemoryItem,
  ProjectNote,
  ProjectRecord,
  ProviderStatusInfo,
  RunRecord,
} from '../shared/types.ts';
import {
  addMemoryEntry,
  apiUrl,
  classifyPromptApi,
  confirmRunAction,
  fetchDownloadsStatus,
  fetchEvalRuns,
  fetchHealth,
  fetchMemories,
  fetchProjectDetail,
  fetchProjects,
  isStandaloneLocalMode,
  retrainBrain,
  startRun,
  triggerEvalRun,
  type DownloadsStatus,
} from './api.ts';
import { BrainPane } from './components/BrainPane.tsx';
import { ChatPanel } from './components/ChatPanel.tsx';
import { EvalsPane } from './components/EvalsPane.tsx';
import { FilesPane } from './components/FilesPane.tsx';
import { MemoryPane } from './components/MemoryPane.tsx';
import { PreviewPane } from './components/PreviewPane.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { VerifyPane } from './components/VerifyPane.tsx';

type RightTab = 'preview' | 'files' | 'verify' | 'brain' | 'memory' | 'evals';

export function App() {
  const [providerStatus, setProviderStatus] = useState<ProviderStatusInfo>();
  const [brainStatus, setBrainStatus] = useState<BrainStatusInfo>();
  const [toolsCount, setToolsCount] = useState(0);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | undefined>();
  const [activeProject, setActiveProject] = useState<ProjectRecord | undefined>();
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [files, setFiles] = useState<Array<{ path: string; size: number }>>([]);
  const [projectNotes, setProjectNotes] = useState<ProjectNote[]>([]);
  const [activeRun, setActiveRun] = useState<RunRecord | undefined>();
  const [logs, setLogs] = useState<ActionLogEntry[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [evalRuns, setEvalRuns] = useState<EvalRunRecord[]>([]);
  const [downloadsStatus, setDownloadsStatus] = useState<DownloadsStatus | null>(null);
  const [isRunningEval, setIsRunningEval] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>('preview');
  const [previewReloadKey, setPreviewReloadKey] = useState(0);

  const esRef = useRef<EventSource | null>(null);

  const loadWorkspaceData = useCallback(async (projectId: string) => {
    const detail = await fetchProjectDetail(projectId);
    setActiveProject(detail.project);
    setMessages(detail.messages);
    setFiles(detail.files);
    setProjectNotes(detail.notes);
    setActiveRun(detail.runs[0]);
    setLogs(detail.logs);
    setPreviewReloadKey((k) => k + 1);
  }, []);

  const refreshGlobal = useCallback(async () => {
    const [health, projList, memList, evalList, dlStatus] = await Promise.all([
      fetchHealth(),
      fetchProjects(),
      fetchMemories(),
      fetchEvalRuns(),
      fetchDownloadsStatus(),
    ]);
    setProviderStatus(health.status);
    setBrainStatus(health.brain);
    setToolsCount(health.toolsCount);
    setProjects(projList);
    setMemories(memList);
    setEvalRuns(evalList);
    setDownloadsStatus(dlStatus);
    return projList;
  }, []);

  useEffect(() => {
    refreshGlobal().then((list) => {
      if (list.length > 0 && !activeProjectId) {
        setActiveProjectId(list[0].id);
        void loadWorkspaceData(list[0].id);
      }
    });
    return () => {
      esRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attachRunStream = useCallback(
    (runId: string, projectId: string) => {
      esRef.current?.close();
      const es = new EventSource(apiUrl(`/api/runs/${encodeURIComponent(runId)}/stream`));
      esRef.current = es;

      es.addEventListener('snapshot', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as {
          run: RunRecord;
          logs: ActionLogEntry[];
        };
        setActiveRun(data.run);
        setLogs(data.logs);
      });

      es.addEventListener('log', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as {
          run: RunRecord;
          log: ActionLogEntry;
        };
        setActiveRun(data.run);
        setLogs((prev) => (prev.some((l) => l.id === data.log.id) ? prev : [...prev, data.log]));
      });

      es.addEventListener('run_update', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as { run: RunRecord };
        setActiveRun(data.run);
        if (
          data.run.status === 'completed' ||
          data.run.status === 'failed' ||
          data.run.status === 'awaiting_confirmation'
        ) {
          void loadWorkspaceData(projectId);
          void refreshGlobal();
          if (data.run.status === 'completed') {
            setRightTab('preview');
          }
          es.close();
        }
      });

      es.onerror = () => {
        es.close();
        void loadWorkspaceData(projectId);
      };
    },
    [loadWorkspaceData, refreshGlobal],
  );

  const handleSelectProject = (id: string) => {
    esRef.current?.close();
    setActiveProjectId(id);
    void loadWorkspaceData(id);
  };

  const handleNewProject = () => {
    esRef.current?.close();
    setActiveProjectId(undefined);
    setActiveProject(undefined);
    setMessages([]);
    setFiles([]);
    setProjectNotes([]);
    setActiveRun(undefined);
    setLogs([]);
  };

  const handleSubmitPrompt = async (prompt: string) => {
    const { project, run } = await startRun({ projectId: activeProjectId, prompt });
    setActiveProjectId(project.id);
    setActiveProject(project);
    setActiveRun(run);
    setLogs([]);
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        runId: run.id,
        projectId: project.id,
        role: 'user',
        content: prompt,
        createdAt: new Date().toISOString(),
      },
    ]);
    await refreshGlobal();
    if (isStandaloneLocalMode() || run.status === 'completed') {
      await loadWorkspaceData(project.id);
      setRightTab('preview');
    } else {
      attachRunStream(run.id, project.id);
    }
  };

  const handleConfirmAction = async (runId: string, approved: boolean) => {
    if (!activeProjectId) return;
    await confirmRunAction(runId, approved);
    attachRunStream(runId, activeProjectId);
  };

  const handleAddMemory = async (input: {
    category: MemoryItem['category'];
    title: string;
    content: string;
  }) => {
    await addMemoryEntry(input);
    setMemories(await fetchMemories());
  };

  const handleRunEval = async () => {
    setIsRunningEval(true);
    try {
      await triggerEvalRun();
      setEvalRuns(await fetchEvalRuns());
      setMemories(await fetchMemories());
    } finally {
      setIsRunningEval(false);
    }
  };

  const handleRetrainBrain = async () => {
    const updated = await retrainBrain();
    setBrainStatus(updated);
  };

  const hasHtml = files.some((f) => f.path === 'index.html');
  const isBusy = activeRun?.status === 'running';

  return (
    <div className="studio-shell">
      <Sidebar
        projects={projects}
        activeProjectId={activeProjectId}
        providerStatus={providerStatus}
        toolsCount={toolsCount}
        downloadsStatus={downloadsStatus}
        onSelectProject={handleSelectProject}
        onNewProject={handleNewProject}
        onServerChange={() => void refreshGlobal()}
      />

      <ChatPanel
        project={activeProject}
        messages={messages}
        activeRun={activeRun}
        logs={logs}
        isBusy={isBusy}
        onSubmitPrompt={(p) => void handleSubmitPrompt(p)}
        onConfirmAction={(id, ok) => void handleConfirmAction(id, ok)}
      />

      <section className="right-pane" aria-label="Workspace preview and inspector">
        <div className="tab-bar" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={rightTab === 'preview'}
            className={`tab-btn ${rightTab === 'preview' ? 'active' : ''}`}
            onClick={() => setRightTab('preview')}
          >
            <Eye size={13} />
            Live Preview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rightTab === 'files'}
            className={`tab-btn ${rightTab === 'files' ? 'active' : ''}`}
            onClick={() => setRightTab('files')}
          >
            <FileCode2 size={13} />
            Files ({files.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rightTab === 'verify'}
            className={`tab-btn ${rightTab === 'verify' ? 'active' : ''}`}
            onClick={() => setRightTab('verify')}
          >
            <CheckSquare size={13} />
            Verify &amp; Critique
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rightTab === 'brain'}
            className={`tab-btn ${rightTab === 'brain' ? 'active' : ''}`}
            onClick={() => setRightTab('brain')}
          >
            <Cpu size={13} />
            Brain AI
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rightTab === 'memory'}
            className={`tab-btn ${rightTab === 'memory' ? 'active' : ''}`}
            onClick={() => setRightTab('memory')}
          >
            <BookOpen size={13} />
            Memory ({memories.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rightTab === 'evals'}
            className={`tab-btn ${rightTab === 'evals' ? 'active' : ''}`}
            onClick={() => setRightTab('evals')}
          >
            <Activity size={13} />
            Evals
          </button>
        </div>

        <div className="right-body">
          {rightTab === 'preview' && (
            <PreviewPane project={activeProject} hasHtml={hasHtml} reloadKey={previewReloadKey} />
          )}
          {rightTab === 'files' && <FilesPane projectId={activeProjectId} files={files} />}
          {rightTab === 'verify' && <VerifyPane run={activeRun} />}
          {rightTab === 'brain' && (
            <BrainPane
              brain={brainStatus}
              onRetrain={handleRetrainBrain}
              onClassify={classifyPromptApi}
            />
          )}
          {rightTab === 'memory' && (
            <MemoryPane
              memories={memories}
              projectNotes={projectNotes}
              onAddMemory={handleAddMemory}
            />
          )}
          {rightTab === 'evals' && (
            <EvalsPane evalRuns={evalRuns} isRunningEval={isRunningEval} onRunEval={handleRunEval} />
          )}
        </div>
      </section>
    </div>
  );
}
