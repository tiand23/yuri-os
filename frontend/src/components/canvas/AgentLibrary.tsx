"use client";

import { useAppStore } from "@/lib/store";
import { BrainCircuit, Code, Code2, Database, Search, Cpu, GitBranch, RefreshCw } from "lucide-react";
import { useT } from "@/lib/useT";

const roleIcons: Record<string, any> = {
  architect: BrainCircuit,
  coder: Code,
  researcher: Search,
  database: Database,
  default: Cpu,
};

interface AgentLibraryProps {
  onSyncAgents?: () => void;
  isSyncing?: boolean;
}

export function AgentLibrary({ onSyncAgents, isSyncing }: AgentLibraryProps) {
  const globalAgents = useAppStore((state) => state.globalAgents);
  const t = useT();

  const onDragStart = (event: React.DragEvent, nodeType: string, nodeRole: string, nodeLabel: string, nodeDesc: string, nodeInput: string, nodeOutput: string, nodeSystemPrompt: string) => {
    event.dataTransfer.setData("application/reactflow-nodetype", nodeType);
    event.dataTransfer.setData("application/reactflow", nodeRole);
    event.dataTransfer.setData("application/reactflow-label", nodeLabel);
    event.dataTransfer.setData("application/reactflow-desc", nodeDesc);
    event.dataTransfer.setData("application/reactflow-input", nodeInput || "");
    event.dataTransfer.setData("application/reactflow-output", nodeOutput || "");
    event.dataTransfer.setData("application/reactflow-system-prompt", nodeSystemPrompt || "");
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="absolute top-4 left-4 z-10 w-64 rounded-lg border border-primary/30 bg-card/90 p-4 shadow-2xl backdrop-blur-md max-h-[80vh] flex flex-col">
      <div className="mb-3 shrink-0 flex items-center justify-between">
        <h3 className="font-mono text-sm font-bold text-primary tracking-widest flex items-center">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse mr-2"></span>
          {t('blueprint_library_title')}
        </h3>
        {onSyncAgents && (
          <button
            onClick={onSyncAgents}
            disabled={isSyncing}
            title={t('btn_sync_tooltip')}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-primary/60 border border-primary/20 rounded hover:bg-primary/10 hover:text-primary transition-all disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} />
            {t('btn_sync')}
          </button>
        )}
      </div>

      {/* 条件分支节点 — 固定内置 */}
      <div
        draggable
        onDragStart={(e) => onDragStart(e, "condition", "condition", t('condition_node_name_default'), t('condition_node_desc_default'), "", "", "")}
        className="group flex shrink-0 cursor-grab items-center space-x-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-2 mb-2 transition-all hover:bg-yellow-500/15 hover:border-yellow-500/60 hover:shadow-[0_0_15px_rgba(234,179,8,0.3)] active:cursor-grabbing"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded bg-yellow-500/20 border border-yellow-500/40 group-hover:border-yellow-400">
          <GitBranch className="h-4 w-4 text-yellow-400" />
        </div>
        <div className="flex flex-col">
          <span className="font-mono text-xs font-bold text-yellow-300 tracking-wider">{t('condition_node_label')}</span>
          <span className="font-mono text-[9px] text-yellow-500/60">{t('condition_node_sub')}</span>
        </div>
      </div>

      {/* Code 节点 — 固定内置，沙箱 Python，无 LLM 调用 */}
      <div
        draggable
        onDragStart={(e) => onDragStart(e, "code", "code", t('code_node_name_default'), t('code_node_desc_default'), "", "", "")}
        className="group flex shrink-0 cursor-grab items-center space-x-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 mb-3 transition-all hover:bg-emerald-500/15 hover:border-emerald-500/60 hover:shadow-[0_0_15px_rgba(16,185,129,0.3)] active:cursor-grabbing"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded bg-emerald-500/20 border border-emerald-500/40 group-hover:border-emerald-400">
          <Code2 className="h-4 w-4 text-emerald-400" />
        </div>
        <div className="flex flex-col">
          <span className="font-mono text-xs font-bold text-emerald-300 tracking-wider">{t('code_node_label')}</span>
          <span className="font-mono text-[9px] text-emerald-500/60">{t('code_node_sub')}</span>
        </div>
      </div>

      <div className="border-t border-white/5 mb-3" />

      <div className="flex flex-col space-y-3 overflow-y-auto pb-2 pr-1 custom-scrollbar">
        {globalAgents.map((agent) => {
          const Icon = roleIcons[agent.role] || roleIcons.default;
          return (
            <div
              key={agent.id}
              draggable
              onDragStart={(e) => onDragStart(e, "agent", agent.role, agent.label, agent.description, agent.input, agent.output, agent.system_prompt || "")}
              className="group flex shrink-0 cursor-grab items-center space-x-3 rounded-md border border-primary/20 bg-primary/5 p-2 transition-all hover:bg-primary/20 hover:border-primary/50 hover:shadow-[0_0_15px_rgba(153,51,255,0.4)] active:cursor-grabbing"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/20 border border-primary/30 group-hover:border-primary">
                <Icon className="h-4 w-4 text-primary brightness-150" />
              </div>
              <div className="flex flex-col">
                <span className="font-mono text-xs font-bold text-white tracking-wider">{agent.label}</span>
                <span className="font-mono text-[9px] text-primary/60 truncate w-36">{agent.description}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 border-t border-primary/20 pt-3 text-[10px] text-white/55 font-mono">
        {t('drag_hint')}
      </div>
    </div>
  );
}
