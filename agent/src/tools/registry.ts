import fs from 'node:fs';
import type { LLMToolDeclaration } from '../llm/types.ts';
import type { AxiomStore } from '../memory/store.ts';
import type { PreviewManager } from './preview.ts';

export interface ToolContext {
  projectId: string;
  runId: string;
  workspacePath: string;
  store: AxiomStore;
  previewManager: PreviewManager;
  cmdTimeoutMs: number;
  approvedConfirmationId?: string;
}

export interface ToolResult {
  ok: boolean;
  output: unknown;
  summary: string;
  requiresConfirmation?: {
    toolName: string;
    reason: string;
    args: Record<string, unknown>;
  };
}

export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  source: 'builtin' | 'plugin';
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface PluginConfigEntry {
  id: string;
  name: string;
  enabled: boolean;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  notes?: string;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private configuredPlugins: PluginConfigEntry[] = [];

  register(tool: RegisteredTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  listPlugins(): PluginConfigEntry[] {
    return [...this.configuredPlugins];
  }

  toLLMDeclarations(): LLMToolDeclaration[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  loadPluginsConfig(configPath: string): void {
    if (!fs.existsSync(configPath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        plugins?: PluginConfigEntry[];
      };
      if (Array.isArray(raw.plugins)) {
        this.configuredPlugins = raw.plugins;
      }
    } catch {
      // Ignore invalid optional plugin file cleanly
    }
  }
}
