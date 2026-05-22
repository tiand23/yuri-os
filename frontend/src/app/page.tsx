"use client";

import { useEffect, useRef, useState } from "react";
import { BrainCircuit, Terminal, Plus, Trash2, CheckCircle2, Clock } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { useCommanderStore } from "@/lib/commander-store";
import { useRouter } from "next/navigation";
import { MiniCanvas } from "@/components/canvas/MiniCanvas";
import { useT } from "@/lib/useT";
import { useI18nStore } from "@/lib/i18n-store";

function computeDagLayout(
  nodes: { id: string }[],
  edges: { source: string; target: string }[]
): Record<string, { x: number; y: number }> {
  const outgoing: Record<string, string[]> = {};
  const incomingCount: Record<string, number> = {};
  nodes.forEach(n => { outgoing[n.id] = []; incomingCount[n.id] = 0; });
  edges.forEach(e => {
    if (outgoing[e.source] !== undefined && incomingCount[e.target] !== undefined) {
      outgoing[e.source].push(e.target);
      incomingCount[e.target]++;
    }
  });

  // BFS to assign layers
  const layer: Record<string, number> = {};
  const queue: string[] = nodes.filter(n => incomingCount[n.id] === 0).map(n => n.id);
  queue.forEach(id => { layer[id] = 0; });
  const remaining = { ...incomingCount };
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    for (const target of outgoing[id]) {
      if (layer[target] === undefined || layer[target] < layer[id] + 1) {
        layer[target] = layer[id] + 1;
      }
      remaining[target]--;
      if (remaining[target] === 0) queue.push(target);
    }
  }
  nodes.forEach(n => { if (layer[n.id] === undefined) layer[n.id] = 0; });

  // Group by layer
  const groups: Record<number, string[]> = {};
  nodes.forEach(n => {
    const l = layer[n.id];
    if (!groups[l]) groups[l] = [];
    groups[l].push(n.id);
  });

  const NODE_W = 320, NODE_H = 280, H_GAP = 130, V_GAP = 80, START_X = 120, START_Y = 120;
  const maxH = Math.max(...Object.values(groups).map(ids => ids.length * NODE_H + (ids.length - 1) * V_GAP));
  const positions: Record<string, { x: number; y: number }> = {};
  Object.entries(groups).forEach(([lStr, ids]) => {
    const l = parseInt(lStr);
    const totalH = ids.length * NODE_H + (ids.length - 1) * V_GAP;
    const yStart = START_Y + (maxH - totalH) / 2;
    ids.forEach((id, i) => {
      positions[id] = { x: START_X + l * (NODE_W + H_GAP), y: yStart + i * (NODE_H + V_GAP) };
    });
  });
  return positions;
}

export default function CommanderTerminal() {
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const setCanvasData = useAppStore((state) => state.setCanvasData);

  const {
    sessions,
    activeSessionId,
    createSession,
    setActiveSession,
    addMessage,
    setPendingPlan,
    markDeployed,
    deleteSession,
    bindSessionToWorkspace,
  } = useCommanderStore();

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null;
  const canvasNodes = useAppStore((state) => state.canvasNodes);
  const canvasEdges = useAppStore((state) => state.canvasEdges);
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);

  const t = useT();
  const locale = useI18nStore((s) => s.locale);
  const [inputText, setInputText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // 初次进入且没有任何会话时，自动新建一个并绑定当前活动战区
  useEffect(() => {
    if (sessions.length === 0) {
      const id = createSession(activeWorkspaceId, t('new_session'));
      addMessage(id, { role: 'system', content: t('msg_init_uplink') });
    } else {
      if (!activeSessionId) {
        setActiveSession(sessions[0].id);
      }
      // Session healing check: bind any active session with workspaceId: null to the loaded activeWorkspaceId
      if (activeWorkspaceId && activeSession && !activeSession.workspaceId) {
        bindSessionToWorkspace(activeSession.id, activeWorkspaceId);
      }
    }
  }, [activeWorkspaceId, activeSessionId, activeSession?.id, sessions.length]);

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages]);

  const handleNewSession = () => {
    const id = createSession(activeWorkspaceId, t('new_session'));
    addMessage(id, { role: 'system', content: t('msg_new_terminal') });
    setInputText("");
  };

  const handleTransmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isProcessing || !activeSessionId) return;

    const userPrompt = inputText;
    const sessionId = activeSessionId;
    
    // Calculate if we have active canvas nodes or a pending plan
    const hasActiveNodes = canvasNodes && canvasNodes.length > 0;
    const hasPendingPlan = activeSession?.pendingPlan !== null && activeSession?.pendingPlan !== undefined;
    const isModifying = hasPendingPlan || hasActiveNodes || activeSession?.deployed;

    setInputText("");
    addMessage(sessionId, { role: 'user', content: userPrompt });
    addMessage(sessionId, {
      role: 'system',
      content: isModifying ? t('msg_processing_modify') : t('msg_processing_new'),
    });
    setIsProcessing(true);

    try {
      let currentArch: { nodes: any[]; edges: any[] } | undefined = undefined;

      if (hasPendingPlan && !activeSession?.deployed) {
        // Use pending plan as baseline before deployment
        const plan = activeSession!.pendingPlan!;
        currentArch = {
          nodes: plan.nodes.map((n: any) => ({
            id: n.id,
            label: n.data.label,
            role: n.data.role,
            description: n.data.description,
            input: n.data.input,
            output: n.data.output
          })),
          edges: plan.edges.map((e: any) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            description: e.label || ""
          }))
        };
      } else if (hasActiveNodes) {
        // Use live canvas state as baseline
        currentArch = {
          nodes: canvasNodes.map((n: any) => ({
            id: n.id,
            label: n.data.label,
            role: n.data.role,
            description: n.data.description,
            input: n.data.input,
            output: n.data.output
          })),
          edges: canvasEdges.map((e: any) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            description: e.label || ""
          }))
        };
      }

      const result = await api.architectAgents(userPrompt, currentArch, locale);

      // Map manual positions for unchanged nodes to avoid layouts changing on users
      const existingPositionsMap = new Map(canvasNodes.map(n => [n.data.label.toLowerCase(), n.position]));
      const computedPositions = computeDagLayout(result.nodes, result.edges);

      const flowNodes = result.nodes.map((n: any) => {
        const key = n.label.toLowerCase();
        const preservedPosition = existingPositionsMap.get(key);
        return {
          id: n.id,
          type: "agent",
          position: preservedPosition ?? computedPositions[n.id] ?? { x: 100, y: 100 },
          data: { label: n.label, role: n.role, status: "idle", description: n.description, input: n.input, output: n.output, system_prompt: n.system_prompt || "" },
        };
      });

      const flowEdges = result.edges.map((e: any) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "smoothstep",
        animated: true,
        label: e.description || "",
        labelStyle: { fill: "oklch(0.60 0.25 290)", fontWeight: "bold", fontSize: 12 },
        labelBgStyle: { fill: "rgba(0,0,0,0.8)", stroke: "oklch(0.60 0.25 290)", strokeWidth: 1 },
        style: { stroke: "oklch(0.60 0.25 290)", strokeWidth: 2, filter: "drop-shadow(0 0 5px oklch(0.60 0.25 290))" },
      }));

      const planSummary = isModifying
        ? `${t('msg_plan_modify_home')}\n${result.nodes.map((n: any) => `${t('msg_node_role_prefix')}${n.role.toUpperCase()}] ${n.label}: ${n.description}`).join("\n")}`
        : `${t('msg_plan_new_home')}\n${result.nodes.map((n: any) => `${t('msg_node_role_prefix')}${n.role.toUpperCase()}] ${n.label}: ${n.description}`).join("\n")}`;

      addMessage(sessionId, { role: 'system', content: planSummary });
      setPendingPlan(sessionId, { nodes: flowNodes, edges: flowEdges });

    } catch (error) {
      addMessage(sessionId, { role: 'system', content: `${t('msg_arch_error_prefix')}${error}` });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmDeployment = async () => {
    if (!activeSession?.pendingPlan || !activeSessionId) return;
    const sessionId = activeSessionId;
    const plan = activeSession.pendingPlan;

    addMessage(sessionId, { role: 'system', content: t('msg_home_deploy_start') });
    setIsProcessing(true);

    try {
      const { globalAgents, addAgent, activeWorkspaceId } = useAppStore.getState();
      if (activeWorkspaceId) {
        const existingLabels = new Set(globalAgents.map(a => a.label));
        for (const node of plan.nodes) {
          const { label, role, description, input, output, system_prompt } = node.data;
          if (!existingLabels.has(label)) {
            const newAgent = await api.createAgent(activeWorkspaceId, {
              role: role || "default",
              label,
              description: description || "",
              input: input || "",
              output: output || "",
              config_json: { system_prompt: system_prompt || "" },
            });
            addAgent({ id: newAgent.id.toString(), role: newAgent.role, label: newAgent.label, description: newAgent.description || "", input: newAgent.input || "", output: newAgent.output || "", system_prompt: system_prompt || "" });
            existingLabels.add(label);
          }
        }
        const updatedWs = await api.updateCanvas(activeWorkspaceId, { nodes: plan.nodes, edges: plan.edges });
        // Update workspaces array in Zustand to avoid stale out-of-sync local reads
        const currentWorkspaces = useAppStore.getState().workspaces;
        const updatedWorkspaces = currentWorkspaces.map(w => w.id === activeWorkspaceId ? updatedWs : w);
        useAppStore.getState().setWorkspaces(updatedWorkspaces);
      }

      setCanvasData(plan.nodes, plan.edges);
      addMessage(sessionId, { role: 'system', content: t('msg_home_deploy_done') });
      markDeployed(sessionId);

      setTimeout(() => router.push("/canvas"), 1000);
    } catch (err) {
      addMessage(sessionId, { role: 'system', content: t('msg_home_deploy_error') });
      setIsProcessing(false);
    }
  };

  const handleAbortDeployment = () => {
    if (!activeSessionId) return;
    addMessage(activeSessionId, { role: 'system', content: t('msg_home_abort') });
    setPendingPlan(activeSessionId, null);
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] w-full gap-0 overflow-hidden rounded-xl border border-primary/30 shadow-[0_0_30px_rgba(153,51,255,0.15)]">

      {/* 左侧：历史会话列表 */}
      <div className="w-64 shrink-0 flex flex-col bg-sidebar border-r border-primary/20">
        <div className="p-3 border-b border-primary/20">
          <button
            onClick={handleNewSession}
            className="w-full flex items-center gap-2 px-3 py-2 font-mono text-xs font-bold text-primary border border-primary/40 hover:bg-primary/10 hover:border-primary transition-all rounded"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('new_session')}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          {sessions.map(session => (
            <div
              key={session.id}
              onClick={() => setActiveSession(session.id)}
              className={`group relative flex flex-col gap-0.5 px-3 py-2.5 rounded cursor-pointer transition-all ${
                activeSessionId === session.id
                  ? 'bg-primary/20 border border-primary/40'
                  : 'hover:bg-primary/10 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-1.5 pr-5">
                {session.deployed
                  ? <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
                  : <Terminal className="h-3 w-3 text-primary/60 shrink-0" />
                }
                <span className="font-mono text-xs text-white truncate">{session.title}</span>
              </div>
              <span className="font-mono text-[10px] text-white/50 flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                {new Date(session.createdAt).toLocaleDateString(
                  locale === 'en' ? 'en-US' : locale === 'ja' ? 'ja-JP' : 'zh-CN',
                  { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
                )}
              </span>

              <button
                onClick={e => { e.stopPropagation(); deleteSession(session.id); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 text-red-500/50 hover:text-red-400 transition-all"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 右侧：当前对话终端 */}
      <div className="flex-1 flex flex-col bg-background crt overflow-hidden">
        {/* 终端标题栏 */}
        <div className="flex items-center justify-between px-4 py-2 bg-primary/10 border-b border-primary/30 shrink-0">
          <div className="flex items-center space-x-2">
            <Terminal className="h-4 w-4 text-primary" />
            <span className="text-xs font-mono text-primary tracking-widest font-bold">{t('terminal_header')}</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="h-2 w-2 rounded-full bg-secondary animate-pulse" />
            <span className="text-xs font-mono text-secondary">{t('online_signal')}</span>
          </div>
        </div>

        {/* 消息区 */}
        <div className="flex-1 overflow-y-auto p-6 font-mono text-sm leading-relaxed custom-scrollbar">
          {!activeSession ? (
            <div className="flex items-center justify-center h-full text-white/35">
              {t('no_session_hint')}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex items-start space-x-4 mb-4">
                <div className="flex-shrink-0 h-14 w-14 rounded-full border-2 border-primary flex items-center justify-center shadow-[0_0_15px_rgba(153,51,255,0.5)] bg-primary/10">
                  <BrainCircuit className="h-7 w-7 text-primary animate-pulse" />
                </div>
                <div className="flex flex-col justify-center py-2">
                  <h2 className="text-xl font-bold tracking-widest text-primary drop-shadow-[0_0_8px_rgba(153,51,255,0.8)]">{t('commander_terminal_title')}</h2>
                  <p className="text-xs text-white/60 tracking-widest uppercase">{t('meta_agent_subtitle')}</p>
                </div>
              </div>

              {activeSession.messages.map((msg, idx) => (
                <div key={idx} className={`whitespace-pre-wrap ${msg.role === 'user' ? 'text-white font-bold border-l-2 border-primary pl-3' : 'text-primary/90'}`}>
                  {msg.role === 'user' && <span className="text-primary/60 text-xs block mb-1">{t('commander_label')}</span>}
                  {msg.content}
                </div>
              ))}

              {isProcessing && (
                <div className="text-primary/60 animate-pulse flex items-center gap-2">
                  <div className="w-2 h-4 bg-primary animate-blink" />
                  {t('processing')}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="p-4 bg-primary/5 border-t border-primary/30 flex flex-col gap-3 shrink-0">
          {activeSession?.pendingPlan && !activeSession.deployed && (
            <div className="flex flex-col w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
              <MiniCanvas nodes={activeSession.pendingPlan.nodes} edges={activeSession.pendingPlan.edges} />
              <div className="flex items-center space-x-4 mt-2">
                <span className="text-secondary font-mono font-bold animate-pulse shrink-0">{t('approve_prompt')}</span>
                <button
                  onClick={handleConfirmDeployment}
                  disabled={isProcessing}
                  className="px-6 py-2 bg-secondary/20 text-secondary font-mono text-sm font-bold border border-secondary/50 hover:bg-secondary hover:text-secondary-foreground hover:shadow-[0_0_15px_rgba(102,255,102,0.8)] transition-all tracking-widest disabled:opacity-50"
                >
                  {t('confirm_deploy')}
                </button>
                <button
                  onClick={handleAbortDeployment}
                  disabled={isProcessing}
                  className="px-6 py-2 bg-destructive/20 text-destructive font-mono text-sm font-bold border border-destructive/50 hover:bg-destructive hover:text-destructive-foreground hover:shadow-[0_0_15px_rgba(255,51,51,0.8)] transition-all tracking-widest disabled:opacity-50"
                >
                  {t('abort_action')}
                </button>
              </div>
            </div>
          )}

          <form onSubmit={handleTransmit} className="flex items-center space-x-3 w-full">
            <span className="text-primary font-mono font-bold text-lg">{'>'}</span>
            <input
              type="text"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              disabled={isProcessing || !activeSession}
              className="flex-1 bg-transparent font-mono text-foreground focus:outline-none placeholder:text-white/35 disabled:opacity-50"
              placeholder={
                !activeSession ? t('placeholder_no_session') :
                activeSession.pendingPlan ? t('placeholder_pending') :
                t('placeholder_new')
              }
              autoFocus
            />
            <button
              type="submit"
              disabled={isProcessing || !activeSession}
              className="px-6 py-2 bg-primary/20 text-primary font-mono text-sm font-bold border border-primary/50 hover:bg-primary hover:text-primary-foreground hover:shadow-[0_0_15px_rgba(153,51,255,0.8)] transition-all tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {activeSession?.pendingPlan ? t('btn_modify') : t('btn_send')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
