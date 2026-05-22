import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LLMProfile {
  id: string;
  name: string;       // 展示名，如 "DeepSeek Chat"
  baseUrl: string;    // API Base URL
  apiKey: string;     // API Key（前端仅用于测试，实际执行走后端 .env）
  modelId: string;    // 模型 ID，如 "deepseek-chat"
  temperature: number;
}

const DEFAULT_PROFILES: LLMProfile[] = [
  {
    id: "default_deepseek",
    name: "DeepSeek Chat (全局默认)",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    modelId: "deepseek-chat",
    temperature: 0.1,
  },
];

interface LLMStore {
  profiles: LLMProfile[];
  activeProfileId: string;
  addProfile: (profile: Omit<LLMProfile, 'id'>) => void;
  updateProfile: (id: string, updates: Partial<LLMProfile>) => void;
  deleteProfile: (id: string) => void;
  setActiveProfileId: (id: string) => void;
  getActiveProfile: () => LLMProfile | undefined;
}

export const useLLMStore = create<LLMStore>()(
  persist(
    (set, get) => ({
      profiles: DEFAULT_PROFILES,
      activeProfileId: "default_deepseek",

      addProfile: (profile) =>
        set((state) => ({
          profiles: [
            ...state.profiles,
            { ...profile, id: `profile_${Date.now()}` },
          ],
        })),

      updateProfile: (id, updates) =>
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        })),

      deleteProfile: (id) =>
        set((state) => ({
          profiles: state.profiles.filter((p) => p.id !== id),
          activeProfileId: state.activeProfileId === id ? "default_deepseek" : state.activeProfileId,
        })),

      setActiveProfileId: (id) => set({ activeProfileId: id }),

      getActiveProfile: () => {
        const { profiles, activeProfileId } = get();
        return profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
      },
    }),
    { name: 'yuri-llm-profiles' }
  )
);
