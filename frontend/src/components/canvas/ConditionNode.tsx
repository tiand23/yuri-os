"use client";

import { Handle, Position, NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/useT";

export function ConditionNode({ data, selected }: NodeProps) {
  const t = useT();
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center w-[220px] h-[120px]",
        "border-2 bg-card/90 backdrop-blur-xl shadow-2xl transition-all",
        "border-yellow-500/70 shadow-[0_0_20px_rgba(234,179,8,0.2)]",
        selected && "border-yellow-400 shadow-[0_0_40px_rgba(234,179,8,0.6)] ring-2 ring-yellow-400 scale-[1.02]",
        // 菱形裁剪
        "[clip-path:polygon(50%_0%,100%_50%,50%_100%,0%_50%)]"
      )}
    >
      <div className="flex flex-col items-center gap-1 px-8">
        <GitBranch className="h-5 w-5 text-yellow-400" />
        <span className="font-mono text-xs font-bold text-yellow-300 tracking-wider text-center leading-tight">
          {(data.label as string) || t('condition_node_name_default')}
        </span>
      </div>

      {/* Input handle — top */}
      <Handle
        type="target"
        position={Position.Top}
        className="!cursor-crosshair h-3 w-3 rounded-full border-2 border-black bg-yellow-400 shadow-[0_0_8px_rgba(234,179,8,1)] hover:scale-150 transition-all"
        style={{ top: 0 }}
      />
      {/* True — right */}
      <Handle
        type="source"
        id="true"
        position={Position.Right}
        className="!cursor-crosshair h-3 w-3 rounded-full border-2 border-black bg-green-400 shadow-[0_0_8px_rgba(74,222,128,1)] hover:scale-150 transition-all"
        style={{ right: 0 }}
      />
      {/* False — left */}
      <Handle
        type="source"
        id="false"
        position={Position.Left}
        className="!cursor-crosshair h-3 w-3 rounded-full border-2 border-black bg-red-400 shadow-[0_0_8px_rgba(248,113,113,1)] hover:scale-150 transition-all"
        style={{ left: 0 }}
      />
    </div>
  );
}
