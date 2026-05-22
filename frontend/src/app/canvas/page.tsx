import { CanvasEditor } from "@/components/canvas/CanvasEditor";
import { ReactFlowProvider } from "@xyflow/react";

export default function CanvasPage() {
  return (
    // Subtract header height (4rem / 64px) to make canvas take exact remaining viewport height
    <div className="h-[calc(100vh-4rem)] w-full">
      <ReactFlowProvider>
        <CanvasEditor />
      </ReactFlowProvider>
    </div>
  );
}
