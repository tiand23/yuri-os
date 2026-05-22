"use client";

import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { BrainCircuit, Cpu, Code, Database, Search, FileText, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/useT";

const roleIcons: Record<string, any> = {
  searcher: Search,
  summarizer: FileText,
  writer: PenLine,
  coder: Code,
  formatter: Database,
  default: Cpu,
  architect: BrainCircuit,
};

export type AgentNodeData = {
  label: string;
  role: string;
  status: "idle" | "running" | "error";
  description?: string;
  input?: string;
  output?: string;
  diffStatus?: "added" | "deleted" | "unchanged";
};

export function AgentNode({ data, selected }: NodeProps<Node<AgentNodeData>>) {
  const Icon = roleIcons[data.role] || roleIcons.default;
  const isAdded = data.diffStatus === "added";
  const isDeleted = data.diffStatus === "deleted";
  const t = useT();

  return (
    <div
      className={cn(
        "relative w-[300px] rounded-lg border bg-card/90 p-5 shadow-2xl backdrop-blur-xl transition-all duration-300",
        !isAdded && !isDeleted && "border-primary/60 shadow-[0_8px_30px_rgba(153,51,255,0.2)]",
        isAdded && "border-emerald-500/80 shadow-[0_0_30px_rgba(16,185,129,0.5)] ring-2 ring-emerald-500/30",
        isDeleted && "border-dashed border-red-500/60 shadow-[0_0_15px_rgba(239,68,68,0.15)] opacity-40 grayscale-[40%]",
        data.status === "running" && "bg-secondary/20 border-secondary shadow-[0_0_40px_rgba(102,255,102,0.6)] ring-2 ring-secondary/60",
        data.status === "error" && "bg-destructive/10 border-destructive shadow-[0_0_30px_rgba(255,51,51,0.4)]",
        selected && "scale-[1.02]",
        selected && data.status !== "running" && data.status !== "error" && !isAdded && !isDeleted && "border-primary shadow-[0_0_40px_rgba(153,51,255,0.8)] ring-2 ring-primary"
      )}
    >
      {/* 顶部指示灯 */}
      <div className="absolute top-0 left-0 flex h-full w-2 items-center justify-center overflow-hidden rounded-l-lg bg-primary/20">
        <div
          className={cn(
            "h-full w-full",
            data.status === "running" && "bg-secondary animate-pulse shadow-[0_0_12px_rgba(102,255,102,1)]",
            data.status === "error" && "bg-destructive shadow-[0_0_12px_rgba(255,51,51,1)]",
            isAdded && "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,1)]",
            isDeleted && "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,1)]",
            data.status === "idle" && !isAdded && !isDeleted && "bg-primary/60"
          )}
        />
      </div>

      {isAdded && (
        <span className="absolute -top-2.5 right-4 bg-emerald-500 text-black text-[9px] font-extrabold font-mono px-2 py-0.5 rounded shadow-[0_0_10px_rgba(16,185,129,0.8)] tracking-widest border border-emerald-400">
          {t('diff_added_badge')}
        </span>
      )}
      {isDeleted && (
        <span className="absolute -top-2.5 right-4 bg-red-500 text-white text-[9px] font-extrabold font-mono px-2 py-0.5 rounded shadow-[0_0_10px_rgba(239,68,68,0.8)] tracking-widest border border-red-400">
          {t('diff_deleted_badge')}
        </span>
      )}

      <div className="flex items-center space-x-4 ml-4 mb-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/20 border border-primary/60 shadow-[0_0_15px_rgba(153,51,255,0.4)]">
          <Icon className="h-6 w-6 text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
        </div>
        <div className="flex flex-col overflow-hidden">
          <span className="font-mono text-lg font-bold text-white tracking-widest uppercase truncate drop-shadow-md">
            {data.label}
          </span>
          <span className="font-mono text-xs text-primary font-bold tracking-widest uppercase mt-1">
            {data.role} {t('facility_suffix')}
          </span>
        </div>
      </div>

      <div className="flex flex-col space-y-2 ml-4 mb-4 bg-primary/5 p-3 rounded-md border border-primary/20">
        <div className="flex items-start">
          <span className="text-[10px] font-bold text-primary bg-primary/20 px-1 py-0.5 rounded mr-2 mt-0.5 shrink-0">IN</span>
          <span className="text-xs text-white/80 font-mono leading-tight truncate" title={data.input}>{data.input || "N/A"}</span>
        </div>
        <div className="flex items-start">
          <span className="text-[10px] font-bold text-secondary bg-secondary/20 px-1 py-0.5 rounded mr-2 mt-0.5 shrink-0">OUT</span>
          <span className="text-xs text-white/80 font-mono leading-tight truncate" title={data.output}>{data.output || "N/A"}</span>
        </div>
      </div>

      {data.description && (
        <div className="ml-4 text-xs leading-relaxed text-white/60 font-mono line-clamp-2 border-t border-primary/20 pt-3">
          {data.description}
        </div>
      )}

      {/* Target Handle (Input) */}
      <Handle
        type="target"
        position={Position.Top}
        className="!cursor-crosshair h-4 w-12 rounded-sm border-2 border-black bg-primary shadow-[0_0_12px_rgba(153,51,255,1)] hover:bg-white hover:scale-125 transition-all"
      />
      {/* Source Handle (Output) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!cursor-crosshair h-4 w-12 rounded-sm border-2 border-black bg-secondary shadow-[0_0_12px_rgba(102,255,102,1)] hover:bg-white hover:scale-125 transition-all"
      />
    </div>
  );
}
