import { ReactFlow, Background, BackgroundVariant } from "@xyflow/react";
import { AgentNode } from "./AgentNode";
import { useAppStore } from "@/lib/store";
import { useT } from "@/lib/useT";
import "@xyflow/react/dist/style.css";

const nodeTypes = {
  agent: AgentNode,
};

export function MiniCanvas({ nodes: planNodes, edges: planEdges }: { nodes: any[], edges: any[] }) {
  const { canvasNodes: currentNodes, canvasEdges: currentEdges } = useAppStore();
  const t = useT();

  // 1. Calculate Node Diff by matching id or labels (case-insensitive)
  const renderedNodes: any[] = [];

  const findInCurrent = (node: any) => currentNodes.find(n => 
    n.id === node.id || 
    (n.data?.label && node.data?.label && n.data.label.toLowerCase() === node.data.label.toLowerCase())
  );
  
  const findInPlan = (node: any) => planNodes.find(n => 
    n.id === node.id || 
    (n.data?.label && node.data?.label && n.data.label.toLowerCase() === node.data.label.toLowerCase())
  );

  // Nodes in the new plan: either "added" or "unchanged"
  planNodes.forEach(node => {
    const matchedCurrent = findInCurrent(node);
    if (matchedCurrent) {
      renderedNodes.push({
        ...node,
        data: {
          ...node.data,
          diffStatus: "unchanged" as const
        }
      });
    } else {
      renderedNodes.push({
        ...node,
        data: {
          ...node.data,
          diffStatus: "added" as const
        }
      });
    }
  });

  // Nodes in active canvas but missing in new plan: "deleted"
  currentNodes.forEach(node => {
    const matchedPlan = findInPlan(node);
    if (!matchedPlan) {
      renderedNodes.push({
        ...node,
        data: {
          ...node.data,
          diffStatus: "deleted" as const
        }
      });
    }
  });

  // 2. Calculate Edge Diff
  const getEdgeKeyForCurrent = (edge: any) => {
    const sourceNode = currentNodes.find(n => n.id === edge.source);
    const targetNode = currentNodes.find(n => n.id === edge.target);
    const sourceLabel = sourceNode?.data?.label || edge.source;
    const targetLabel = targetNode?.data?.label || edge.target;
    return `${sourceLabel.toLowerCase()}->${targetLabel.toLowerCase()}`;
  };

  const getEdgeKeyForPlan = (edge: any) => {
    const sourceNode = planNodes.find(n => n.id === edge.source);
    const targetNode = planNodes.find(n => n.id === edge.target);
    const sourceLabel = sourceNode?.data?.label || edge.source;
    const targetLabel = targetNode?.data?.label || edge.target;
    return `${sourceLabel.toLowerCase()}->${targetLabel.toLowerCase()}`;
  };

  const currentEdgeKeys = new Set(currentEdges.map(getEdgeKeyForCurrent));
  const planEdgeKeys = new Set(planEdges.map(getEdgeKeyForPlan));

  const renderedEdges: any[] = [];

  // Edges in the new plan: either "added" or "unchanged"
  planEdges.forEach(edge => {
    const key = getEdgeKeyForPlan(edge);
    const isAdded = !currentEdgeKeys.has(key);
    
    renderedEdges.push({
      ...edge,
      animated: true,
      style: isAdded 
        ? { stroke: "#10b981", strokeWidth: 3, filter: "drop-shadow(0 0 8px #10b981)" }
        : { stroke: "oklch(0.60 0.25 290)", strokeWidth: 2, filter: "drop-shadow(0 0 5px oklch(0.60 0.25 290))" }
    });
  });

  // Edges in active canvas but missing in new plan: "deleted"
  currentEdges.forEach(edge => {
    const key = getEdgeKeyForCurrent(edge);
    if (!planEdgeKeys.has(key)) {
      renderedEdges.push({
        id: `deleted_${edge.id}`,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        animated: false,
        label: edge.label || "",
        style: { stroke: "#ef4444", strokeWidth: 2, strokeDasharray: "5,5", opacity: 0.4 }
      });
    }
  });

  return (
    <div className="h-72 w-full border border-primary/30 rounded-md overflow-hidden my-4 relative bg-black/40">
      <div className="absolute top-2 left-2 z-10 text-[10px] text-white/55 font-mono">{t('mini_canvas_preview')}</div>
      <ReactFlow
        nodes={renderedNodes}
        edges={renderedEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 0.6 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnDrag={true}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="oklch(0.60 0.25 290 / 20%)" />
      </ReactFlow>
    </div>
  );
}
