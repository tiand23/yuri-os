import { create } from 'zustand';
import { Workspace } from './api';

export interface AgentTemplate {
  id: string;
  role: string;
  label: string;
  description: string;
  input: string;
  output: string;
  system_prompt?: string;
}

const defaultAgents: AgentTemplate[] = [];

interface AppState {
  workspaces: Workspace[];
  activeWorkspaceId: number | null;
  canvasNodes: any[];
  canvasEdges: any[];
  globalAgents: AgentTemplate[];
  setWorkspaces: (workspaces: Workspace[]) => void;
  setActiveWorkspaceId: (id: number | null) => void;
  setCanvasData: (nodes: any[], edges: any[]) => void;
  setAgents: (agents: AgentTemplate[]) => void;
  addAgent: (agent: AgentTemplate) => void;
}

export const useAppStore = create<AppState>((set) => ({
  workspaces: [],
  activeWorkspaceId: null,
  canvasNodes: [],
  canvasEdges: [],
  globalAgents: defaultAgents,
  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),
  setCanvasData: (nodes, edges) => set({ canvasNodes: nodes, canvasEdges: edges }),
  setAgents: (agents) => set({ globalAgents: agents }),
  addAgent: (agent) => set((state) => ({ globalAgents: [...state.globalAgents, agent] })),
}));
