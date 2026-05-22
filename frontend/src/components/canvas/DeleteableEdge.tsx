"use client";

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow, type EdgeProps } from "@xyflow/react";
import { X } from "lucide-react";

export function DeletableEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, selected,
  markerEnd, style,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const edgeStyle = selected
    ? { ...style, stroke: "#f87171", strokeWidth: 3, filter: "drop-shadow(0 0 6px #f87171)" }
    : style;

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    deleteElements({ edges: [{ id }] });
  };

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={edgeStyle} />
      <EdgeLabelRenderer>
        {selected && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="nodrag nopan"
          >
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleDelete}
              title="删除连线"
              style={{ pointerEvents: "all" }}
              className="flex items-center justify-center w-6 h-6 rounded-full bg-red-500 border-2 border-red-300 text-white shadow-[0_0_12px_rgba(239,68,68,0.9)] cursor-pointer animate-in zoom-in-75 duration-100 hover:bg-red-400 hover:scale-110 transition-transform"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
