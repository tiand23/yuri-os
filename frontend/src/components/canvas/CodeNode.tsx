"use client";

import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { Code2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/useT";

export type CodeNodeData = {
  label: string;
  role: "code";
  status?: "idle" | "running" | "error";
  description?: string;
  input?: string;
  output?: string;
  code?: string;
  diffStatus?: "added" | "deleted" | "unchanged";
};

export function CodeNode({ data, selected }: NodeProps<Node<CodeNodeData>>) {
  const t = useT();
  const isAdded = data.diffStatus === "added";
  const isDeleted = data.diffStatus === "deleted";

  // Distinct emerald palette so users can tell at a glance: green = deterministic code,
  // purple = LLM agent, yellow diamond = condition. Matches the visual language.
  return (
    <div
      className={cn(
        "relative w-[300px] rounded-lg border bg-card/90 p-5 shadow-2xl backdrop-blur-xl transition-all duration-300",
        !isAdded && !isDeleted && "border-emerald-500/60 shadow-[0_8px_30px_rgba(16,185,129,0.25)]",
        isAdded && "border-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.6)] ring-2 ring-emerald-400/40",
        isDeleted && "border-dashed border-red-500/60 opacity-40 grayscale-[40%]",
        data.status === "running" && "bg-emerald-500/15 border-emerald-300 shadow-[0_0_40px_rgba(16,185,129,0.7)]",
        data.status === "error" && "bg-destructive/10 border-destructive shadow-[0_0_30px_rgba(255,51,51,0.4)]",
        selected && "scale-[1.02] ring-2 ring-emerald-400",
      )}
    >
      <div className="absolute top-0 left-0 flex h-full w-2 items-center justify-center overflow-hidden rounded-l-lg bg-emerald-500/20">
        <div className={cn(
          "h-full w-full",
          data.status === "running" && "bg-emerald-400 animate-pulse",
          data.status === "error" && "bg-destructive",
          data.status !== "running" && data.status !== "error" && "bg-emerald-500/60",
        )} />
      </div>

      <div className="flex items-center space-x-4 ml-4 mb-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 border border-emerald-500/60 shadow-[0_0_15px_rgba(16,185,129,0.4)]">
          <Code2 className="h-6 w-6 text-white drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
        </div>
        <div className="flex flex-col overflow-hidden">
          <span className="font-mono text-lg font-bold text-white tracking-widest uppercase truncate drop-shadow-md">
            {data.label}
          </span>
          <span className="font-mono text-xs text-emerald-300 font-bold tracking-widest uppercase mt-1">
            {t('code_node_badge')}
          </span>
        </div>
      </div>

      <div className="ml-4 mb-3 bg-black/40 p-2 rounded-md border border-emerald-500/20 max-h-20 overflow-hidden">
        <pre className="text-[10px] font-mono text-emerald-200/80 leading-tight whitespace-pre-wrap line-clamp-4">
          {(data.code || "# no code").slice(0, 200)}
        </pre>
      </div>

      {data.description && (
        <div className="ml-4 text-xs leading-relaxed text-white/60 font-mono line-clamp-2 border-t border-emerald-500/20 pt-2">
          {data.description}
        </div>
      )}

      <Handle
        type="target"
        position={Position.Top}
        className="!cursor-crosshair h-4 w-12 rounded-sm border-2 border-black bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,1)] hover:bg-white hover:scale-125 transition-all"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!cursor-crosshair h-4 w-12 rounded-sm border-2 border-black bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,1)] hover:bg-white hover:scale-125 transition-all"
      />
    </div>
  );
}
