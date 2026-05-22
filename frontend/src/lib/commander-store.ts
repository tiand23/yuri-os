import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAppStore } from './store';

export interface CommanderMessage {
  role: 'user' | 'system';
  content: string;
}

export interface CommanderSession {
  id: string;
  title: string;
  createdAt: string;
  messages: CommanderMessage[];
  pendingPlan: { nodes: any[]; edges: any[] } | null;
  deployed: boolean;
  workspaceId?: number | null;
}

interface CommanderStore {
  sessions: CommanderSession[];
  activeSessionId: string | null;
  createSession: (workspaceId?: number | null, defaultTitle?: string) => string;
  setActiveSession: (id: string) => void;
  addMessage: (sessionId: string, msg: CommanderMessage) => void;
  updateLastMessage: (sessionId: string, content: string) => void;
  setPendingPlan: (sessionId: string, plan: { nodes: any[]; edges: any[] } | null) => void;
  markDeployed: (sessionId: string) => void;
  deleteSession: (id: string) => void;
  bindSessionToWorkspace: (sessionId: string, workspaceId: number) => void;
}

export const useCommanderStore = create<CommanderStore>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,
 
      createSession: (workspaceId = null, defaultTitle = 'New Chat') => {
        const id = `session_${Date.now()}`;
        const session: CommanderSession = {
          id,
          title: defaultTitle,
          createdAt: new Date().toISOString(),
          messages: [],
          pendingPlan: null,
          deployed: false,
          workspaceId,
        };
        set(state => ({ sessions: [session, ...state.sessions], activeSessionId: id }));
        return id;
      },

      setActiveSession: (id) => {
        set({ activeSessionId: id });
        const session = get().sessions.find(s => s.id === id);
        if (session && session.workspaceId !== undefined) {
          useAppStore.getState().setActiveWorkspaceId(session.workspaceId);
        }
      },

      addMessage: (sessionId, msg) =>
        set(state => ({
          sessions: state.sessions.map(s => {
            if (s.id !== sessionId) return s;
            const messages = [...s.messages, msg];
            // 用第一条用户消息作为标题
            const title = messages.find(m => m.role === 'user')?.content.slice(0, 30) || s.title;
            return { ...s, messages, title };
          }),
        })),

      updateLastMessage: (sessionId, content) =>
        set(state => ({
          sessions: state.sessions.map(s => {
            if (s.id !== sessionId) return s;
            const messages = [...s.messages];
            if (messages.length > 0) messages[messages.length - 1] = { ...messages[messages.length - 1], content };
            return { ...s, messages };
          }),
        })),

      setPendingPlan: (sessionId, plan) =>
        set(state => ({
          sessions: state.sessions.map(s => s.id === sessionId ? { ...s, pendingPlan: plan, deployed: plan === null ? s.deployed : false } : s),
        })),

      markDeployed: (sessionId) =>
        set(state => ({
          sessions: state.sessions.map(s => s.id === sessionId ? { ...s, deployed: true, pendingPlan: null } : s),
        })),

      deleteSession: (id) =>
        set(state => {
          const sessions = state.sessions.filter(s => s.id !== id);
          const activeSessionId = state.activeSessionId === id
            ? (sessions[0]?.id ?? null)
            : state.activeSessionId;
          return { sessions, activeSessionId };
        }),

      bindSessionToWorkspace: (sessionId, workspaceId) =>
        set(state => ({
          sessions: state.sessions.map(s => s.id === sessionId ? { ...s, workspaceId } : s),
        })),
    }),
    { name: 'yuri-commander-sessions' }
  )
);
