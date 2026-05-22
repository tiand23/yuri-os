"use client";

import { useEffect, useRef } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/api";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { activeWorkspaceId, workspaces, setAgents, setCanvasData, globalAgents } = useAppStore();

  // 1. Fetch agents for this workspace
  useEffect(() => {
    if (activeWorkspaceId) {
      api.getAgents(activeWorkspaceId).then((agents) => {
        if (agents && agents.length > 0) {
          // Map backend AgentConfig to frontend AgentTemplate
          const mappedAgents = agents.map((a: any) => ({
            id: a.id.toString(),
            role: a.role,
            label: a.label,
            description: a.description || "",
            input: a.input || "",
            output: a.output || "",
            system_prompt: a.config_json?.system_prompt || "",
          }));
          setAgents(mappedAgents);
        } else {
          // If no agents, we might want to keep default globalAgents or clear them?
          // Since it's a new workspace, let's inject default ones to DB!
          Promise.all(globalAgents.map(agent =>
            api.createAgent(activeWorkspaceId, agent)
          )).then(() => {
            // Re-fetch after seeding
            api.getAgents(activeWorkspaceId).then(newAgents => {
              const mappedAgents = newAgents.map((a: any) => ({
                id: a.id.toString(),
                role: a.role,
                label: a.label,
                description: a.description || "",
                input: a.input || "",
                output: a.output || "",
                system_prompt: a.config_json?.system_prompt || "",
              }));
              setAgents(mappedAgents);
            });
          });
        }
      });
    }
  }, [activeWorkspaceId, setAgents]);

  // 2. Load canvas data when workspace switches.
  // IMPORTANT: We only load once per workspace switch, not every time `workspaces` is
  // mutated (e.g. after handleSideConfirmDeployment calls setWorkspaces). Loading on
  // every workspaces-update races with CanvasEditor's own setNodes/setCanvasData calls
  // and can blank the canvas with stale/empty data mid-deployment.
  const canvasLoadedForWorkspace = useRef<number | null>(null);

  useEffect(() => {
    console.log('[APPLAYOUT] canvas effect fired. activeWorkspaceId=', activeWorkspaceId, 'ref=', canvasLoadedForWorkspace.current);
    if (!activeWorkspaceId) {
      console.log('[APPLAYOUT] no activeWorkspaceId → setCanvasData([], [])');
      setCanvasData([], []);
      canvasLoadedForWorkspace.current = null;
      return;
    }

    // Already loaded for this workspace — skip to avoid interfering with in-place edits
    if (canvasLoadedForWorkspace.current === activeWorkspaceId) {
      console.log('[APPLAYOUT] guard hit — skipping');
      return;
    }

    // workspaces list not ready yet — wait for next effect run
    const activeWs = workspaces.find(w => w.id === activeWorkspaceId);
    if (!activeWs) {
      console.log('[APPLAYOUT] workspace not found yet — waiting');
      return;
    }

    // Mark as loaded before calling setCanvasData to prevent double-fire
    canvasLoadedForWorkspace.current = activeWorkspaceId;
    const canvasData = (activeWs as any).canvas_data;
    console.log('[APPLAYOUT] loading canvas. nodes=', canvasData?.nodes?.length ?? 0, 'edges=', canvasData?.edges?.length ?? 0);
    setCanvasData(canvasData?.nodes ?? [], canvasData?.edges ?? []);
  }, [activeWorkspaceId, workspaces, setCanvasData]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto bg-background p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
