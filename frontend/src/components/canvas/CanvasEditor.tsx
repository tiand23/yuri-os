"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  BackgroundVariant,
  useReactFlow,
  Node,
  ConnectionMode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useAppStore } from "@/lib/store";
import { useLLMStore } from "@/lib/llm-store";
import { useT } from "@/lib/useT";
import { useI18nStore } from "@/lib/i18n-store";
import { api } from "@/lib/api";
import { useCommanderStore } from "@/lib/commander-store";
import { AgentNode } from "./AgentNode";
import { ConditionNode } from "./ConditionNode";
import { CodeNode } from "./CodeNode";
import { DeletableEdge } from "./DeleteableEdge";
import { AgentLibrary } from "./AgentLibrary";
import { AgentConfigPanel } from "./AgentConfigPanel";
import { MiniCanvas } from "./MiniCanvas";
import { Save, Play, X, Terminal, Info, MousePointer2, Loader2, Upload, ChevronDown, ChevronRight, ExternalLink, CheckCircle2, AlertCircle, Zap, Globe, Sliders, Cpu, Search, FileText, Code, Database, BrainCircuit, Settings, ArrowRight, Check, Sparkles, RefreshCw, Lock, FileJson, Package } from "lucide-react";
import { useRouter } from "next/navigation";

const nodeTypes = {
  agent: AgentNode,
  condition: ConditionNode,
  code: CodeNode,
};

const edgeTypes = {
  deletable: DeletableEdge,
};

type FormTheme = "explorer" | "ide" | "intel" | "matrix" | "mind";

function determineFormTheme(node: Node | null): FormTheme {
  if (!node) return "mind";
  const role = (node.data?.role as string || "").toLowerCase();
  const label = (node.data?.label as string || "").toLowerCase();
  const input = (node.data?.input as string || "").toLowerCase();
  
  if (role === "searcher" || /url|网址|网页|爬取|搜索|search/i.test(input) || /search|explorer/i.test(label)) {
    return "explorer";
  }
  if (role === "coder" || /code|代码|编程|开发|函数|py|js|ts/i.test(input) || /coder|compiler/i.test(label)) {
    return "ide";
  }
  if (role === "summarizer" || role === "writer" || /summary|文档|文章|报告|阅读|文本|pdf|doc/i.test(input)) {
    return "intel";
  }
  if (role === "formatter" || /json|数据|格式|表格|清洗|convert/i.test(input)) {
    return "matrix";
  }
  return "mind";
}

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

export function CanvasEditor() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { canvasNodes, canvasEdges, setCanvasData } = useAppStore();
  const { screenToFlowPosition } = useReactFlow();
  const t = useT();
  const hasFitView = useRef(false);
  const rfInstanceRef = useRef<any>(null);
  // lastLoadedWorkspaceId: used ONLY to reset hasFitView when workspace switches
  const lastLoadedWorkspaceId = useRef<number | null>(null);

  const initialNodes = canvasNodes.length > 0 ? canvasNodes : [];
  const initialEdges = canvasEdges.length > 0 ? canvasEdges : [];

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const startingNodes = nodes.filter(n => !edges.some(e => e.target === n.id));
  const firstNode = startingNodes.length > 0 ? startingNodes[0] : null;

  const onConnect = useCallback(
    (params: Connection | Edge) => {
      const edgeWithStyle = {
        ...params,
        type: "deletable",
        animated: true,
        style: { stroke: "oklch(0.60 0.25 290)", strokeWidth: 2, filter: "drop-shadow(0 0 5px oklch(0.60 0.25 290))" },
      };
      setEdges((eds) => addEdge(edgeWithStyle, eds));
    },
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const nodeType = event.dataTransfer.getData("application/reactflow-nodetype") || "agent";
      const role = event.dataTransfer.getData("application/reactflow");
      const label = event.dataTransfer.getData("application/reactflow-label");
      const description = event.dataTransfer.getData("application/reactflow-desc");
      const input = event.dataTransfer.getData("application/reactflow-input");
      const output = event.dataTransfer.getData("application/reactflow-output");
      const system_prompt = event.dataTransfer.getData("application/reactflow-system-prompt");

      if (!role) return;

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      let newData: Record<string, unknown>;
      if (nodeType === "condition") {
        newData = { label: label || t('condition_node_name_default'), condition_prompt: "" };
      } else if (nodeType === "code") {
        newData = {
          label: label || t('code_node_name_default'),
          role: "code",
          status: "idle",
          description: description || "",
          input: input || "",
          output: output || "",
          code: "import sys\npayload = sys.stdin.read()\n# transform payload here\nprint(payload)",
        };
      } else {
        newData = { label, role, status: "idle", description, input, output, system_prompt };
      }
      const newNode: Node = {
        id: `node_${Date.now()}`,
        type: nodeType,
        position,
        data: newData as any,
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [screenToFlowPosition, setNodes, t]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
    setIsSidepanelOpen(false);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const handleNodeUpdate = useCallback(
    (nodeId: string, newData: any) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
            return { ...node, data: newData };
          }
          return node;
        })
      );
    },
    [setNodes]
  );

  const handleDeleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((node) => node.id !== nodeId));
    setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedNodeId(null);
  }, [setNodes, setEdges]);

  // Sync store → local ReactFlow state whenever canvasNodes/canvasEdges change.
  // This fires on:
  //   - Initial workspace load (AppLayout sets canvasNodes from backend)
  //   - Workspace switch (AppLayout loads new workspace data)
  //   - Deployment (handleSideConfirmDeployment calls setCanvasData)
  //   - Save (handleSaveCanvas calls setCanvasData — effectively a no-op since
  //     canvasNodes will equal current nodes content-wise)
  //
  // We do NOT call setNodes/setEdges directly in handleSideConfirmDeployment anymore.
  // Doing so caused a double-setNodes race: setNodes(plan.nodes) + sync-effect's
  // setNodes(canvasNodes) fired in the same batch, producing a NaN-viewport blank canvas.
  // Having a single source of truth (this effect) eliminates the race entirely.
  const { activeWorkspaceId: syncWorkspaceId } = useAppStore();
  useEffect(() => {
    if (canvasNodes.length === 0 && canvasEdges.length === 0) {
      return;
    }

    // Reset fitView flag when workspace changes so new workspace gets its own fit
    if (syncWorkspaceId && lastLoadedWorkspaceId.current !== syncWorkspaceId) {
      lastLoadedWorkspaceId.current = syncWorkspaceId;
      hasFitView.current = false;
    }

    // Apply incoming store data to local ReactFlow state
    setNodes(canvasNodes);
    setEdges(canvasEdges);

    if (!hasFitView.current) {
      hasFitView.current = true;
      // 350ms gives ReactFlow time to render and measure node dimensions
      const id = setTimeout(async () => {
        const rf = rfInstanceRef.current;
        if (!rf || canvasNodes.length === 0) return;
        // fitView is async in ReactFlow v12 — D3 applies the transform directly to the DOM
        await rf.fitView({ padding: 0.12, maxZoom: 0.85 });
        // Wait 2 rAF frames so D3 finishes writing the transform to .react-flow__viewport
        await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        // Read actual transform from DOM (D3-managed), not Zustand store (which may lag)
        const vpEl = document.querySelector('.react-flow__viewport') as HTMLElement;
        const raw = vpEl?.style?.transform ?? '';
        const m = raw.match(/translate\(([-.0-9]+)px,\s*([-.0-9]+)px\)\s*scale\(([-.0-9]+)\)/);
        if (m) {
          // Shift right by half the AgentLibrary panel width (272px) so nodes center in visible area
          rf.setViewport({ x: parseFloat(m[1]) + 136, y: parseFloat(m[2]), zoom: parseFloat(m[3]) }, { duration: 400 });
        }
      }, 350);
      return () => clearTimeout(id);
    }
  }, [syncWorkspaceId, canvasNodes, canvasEdges, setNodes, setEdges]);

  const { activeWorkspaceId, globalAgents } = useAppStore();
  const { profiles: llmProfiles, activeProfileId, setActiveProfileId, getActiveProfile } = useLLMStore();
  const locale = useI18nStore((s) => s.locale);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const router = useRouter();

  const {
    sessions,
    activeSessionId,
    createSession,
    setActiveSession,
    addMessage,
    setPendingPlan,
    markDeployed,
    bindSessionToWorkspace,
  } = useCommanderStore();

  const [isSidepanelOpen, setIsSidepanelOpen] = useState(false);
  const [sideInput, setSideInput] = useState("");
  const [isSideProcessing, setIsSideProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null;

  // Automatically find or create a session for the active workspace
  useEffect(() => {
    if (!activeWorkspaceId) return;

    // Check if the current active session is an orphan session (workspaceId is null or undefined)
    // If it's an orphan session, hot-bind it to activeWorkspaceId to preserve the history!
    if (activeSession && !activeSession.workspaceId) {
      bindSessionToWorkspace(activeSession.id, activeWorkspaceId);
      return;
    }

    const existingSession = sessions.find(s => s.workspaceId === activeWorkspaceId);
    if (existingSession) {
      if (activeSessionId !== existingSession.id) {
        setActiveSession(existingSession.id);
      }
    } else {
      // If we don't have a session for this workspace, check if there's any orphan session in the store
      const orphanSession = sessions.find(s => !s.workspaceId);
      if (orphanSession) {
        bindSessionToWorkspace(orphanSession.id, activeWorkspaceId);
        setActiveSession(orphanSession.id);
      } else {
        const id = createSession(activeWorkspaceId);
        addMessage(id, {
          role: 'system',
          content: t('msg_link_ready')
        });
      }
    }
  }, [activeWorkspaceId, sessions, activeSessionId, activeSession?.id]);

  // Scroll to bottom of command sidepanel chat
  useEffect(() => {
    if (isSidepanelOpen) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }
  }, [activeSession?.messages, isSidepanelOpen]);

  const handleSideTransmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sideInput.trim() || isSideProcessing || !activeSessionId || !activeWorkspaceId) return;

    const userPrompt = sideInput;
    const sessionId = activeSessionId;
    const hasPendingPlan = activeSession?.pendingPlan !== null && activeSession?.pendingPlan !== undefined;
    const isModifying = hasPendingPlan || nodes.length > 0 || activeSession?.deployed;

    setSideInput("");
    addMessage(sessionId, { role: 'user', content: userPrompt });
    addMessage(sessionId, {
      role: 'system',
      content: isModifying ? t('msg_processing_modify') : t('msg_processing_new'),
    });
    setIsSideProcessing(true);

    try {
      let currentArch: { nodes: any[]; edges: any[] } | undefined = undefined;

      // Mirror page.tsx — preserve condition_prompt / code / tools / sourceHandle when re-architecting.
      const nodeToArchPayload = (n: any) => {
        const isCondition = n.type === "condition" || n.data.role === "condition";
        const isCode = n.type === "code" || n.data.role === "code";
        const baseRole = isCondition ? "condition" : isCode ? "code" : n.data.role;
        const base: any = {
          id: n.id,
          label: n.data.label,
          role: baseRole,
          description: n.data.description || "",
          input: n.data.input || "",
          output: n.data.output || "",
          tools: Array.isArray(n.data.tools) ? n.data.tools : (isCondition || isCode ? [] : undefined),
        };
        if (isCondition) base.condition_prompt = n.data.condition_prompt || "";
        else if (isCode) base.code = n.data.code || "";
        else base.system_prompt = n.data.system_prompt || "";
        return base;
      };
      const edgeToArchPayload = (e: any) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        description: e.label || "",
        ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      });

      if (hasPendingPlan && !activeSession?.deployed) {
        const plan = activeSession!.pendingPlan!;
        currentArch = {
          nodes: plan.nodes.map(nodeToArchPayload),
          edges: plan.edges.map(edgeToArchPayload),
        };
      } else if (nodes.length > 0) {
        currentArch = {
          nodes: nodes.map(nodeToArchPayload),
          edges: edges.map(edgeToArchPayload),
        };
      }

      const result = await api.architectAgents(userPrompt, currentArch, locale);

      // Preserve manually-dragged positions for unchanged nodes
      const existingPositionsMap = new Map(nodes.map(n => [n.data.label.toLowerCase(), n.position]));
      const computedPositions = computeDagLayout(result.nodes, result.edges);

      const flowNodes = result.nodes.map((n: any) => {
        const key = n.label.toLowerCase();
        const preservedPosition = existingPositionsMap.get(key);
        const isCondition = n.role === "condition";
        const isCode = n.role === "code";
        let data: any;
        if (isCondition) {
          data = { label: n.label, role: "condition", status: "idle", condition_prompt: n.condition_prompt || "" };
        } else if (isCode) {
          data = { label: n.label, role: "code", status: "idle", description: n.description, input: n.input, output: n.output, code: n.code || "" };
        } else {
          data = { label: n.label, role: n.role, status: "idle", description: n.description, input: n.input, output: n.output, system_prompt: n.system_prompt || "", tools: Array.isArray(n.tools) ? n.tools : undefined };
        }
        return {
          id: n.id,
          type: isCondition ? "condition" : isCode ? "code" : "agent",
          position: preservedPosition ?? computedPositions[n.id] ?? { x: 100, y: 100 },
          data,
        };
      });

      const flowEdges = result.edges.map((e: any) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
        type: "smoothstep",
        animated: true,
        label: e.description || "",
        labelStyle: { fill: "oklch(0.60 0.25 290)", fontWeight: "bold", fontSize: 12 },
        labelBgStyle: { fill: "rgba(0,0,0,0.8)", stroke: "oklch(0.60 0.25 290)", strokeWidth: 1 },
        style: { stroke: "oklch(0.60 0.25 290)", strokeWidth: 2, filter: "drop-shadow(0 0 5px oklch(0.60 0.25 290))" },
      }));

      const planSummary = isModifying
        ? `${t('msg_plan_complete_modify')}\n${result.nodes.map((n: any) => `${t('msg_node_role_prefix')}${n.role.toUpperCase()}] ${n.label}`).join("\n")}`
        : `${t('msg_plan_complete_new')}\n${result.nodes.map((n: any) => `${t('msg_node_role_prefix')}${n.role.toUpperCase()}] ${n.label}`).join("\n")}`;

      addMessage(sessionId, { role: 'system', content: planSummary });
      setPendingPlan(sessionId, { nodes: flowNodes, edges: flowEdges });

    } catch (error) {
      addMessage(sessionId, { role: 'system', content: `${t('msg_llm_error_prefix')}${error}` });
    } finally {
      setIsSideProcessing(false);
    }
  };

  const handleSideConfirmDeployment = async () => {
    if (!activeSession?.pendingPlan || !activeSessionId || !activeWorkspaceId) return;
    const sessionId = activeSessionId;
    const plan = activeSession.pendingPlan;

    addMessage(sessionId, { role: 'system', content: t('msg_deploy_start') });
    setIsSideProcessing(true);

    try {
      // 1. Create missing agents
      const existingLabels = new Set(globalAgents.map(a => a.label));
      for (const node of plan.nodes) {
        // Condition / code nodes are pure non-LLM cells — they do not live in the Agent Library.
        if (node.type === "condition" || node.data.role === "condition") continue;
        if (node.type === "code" || node.data.role === "code") continue;
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
          useAppStore.getState().addAgent({ id: newAgent.id.toString(), role: newAgent.role, label: newAgent.label, description: newAgent.description || "", input: newAgent.input || "", output: newAgent.output || "", system_prompt: system_prompt || "" });
          existingLabels.add(label);
        }
      }

      // 2. Save canvas to backend
      await api.updateCanvas(activeWorkspaceId, { nodes: plan.nodes, edges: plan.edges });
      // NOTE: intentionally NOT calling setWorkspaces(updatedWs) here.
      // WorkspaceSwitcher will re-fetch fresh workspace data on the next workspace switch.

      // 3. Push new canvas data into Zustand — the sync effect above will call setNodes/setEdges.
      // Reset hasFitView so the sync effect also runs fitView for the newly-deployed nodes.
      hasFitView.current = false;
      setCanvasData(plan.nodes, plan.edges);

      addMessage(sessionId, { role: 'system', content: t('msg_deploy_done') });
      markDeployed(sessionId);

    } catch (err) {
      addMessage(sessionId, { role: 'system', content: t('msg_deploy_error') });
    } finally {
      setIsSideProcessing(false);
    }
  };

  const handleSideAbortDeployment = () => {
    if (!activeSessionId) return;
    addMessage(activeSessionId, { role: 'system', content: t('msg_abort') });
    setPendingPlan(activeSessionId, null);
  };

  // 首次加载完成后才开始追踪未保存状态
  useEffect(() => {
    if (!isInitialized && (nodes.length > 0 || canvasNodes.length === 0)) {
      setIsInitialized(true);
      return;
    }
    if (isInitialized) setHasUnsaved(true);
  }, [nodes, edges]);

  const handleSaveCanvas = async () => {
    if (!activeWorkspaceId) return;
    setIsSaving(true);
    try {
      await api.updateCanvas(activeWorkspaceId, { nodes, edges });
      // NOTE: intentionally NOT calling setWorkspaces here — same reason as handleSideConfirmDeployment.
      setCanvasData(nodes, edges);
      setHasUnsaved(false);
    } catch (err) {
      console.error("Failed to save canvas", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncAgents = useCallback(() => {
    setIsSyncing(true);
    const agentMap = new Map(globalAgents.map(a => [a.label, a]));
    setNodes(nds => nds.map(n => {
      if (n.type !== "agent") return n;
      const match = agentMap.get(n.data.label as string);
      if (!match) return n;
      return {
        ...n,
        data: {
          ...n.data,
          description: match.description,
          input: match.input,
          output: match.output,
          system_prompt: match.system_prompt || n.data.system_prompt,
        }
      };
    }));
    setHasUnsaved(true);
    setTimeout(() => setIsSyncing(false), 600);
  }, [globalAgents, setNodes]);

  const [isExecuting, setIsExecuting] = useState(false);
  const [executingNodeLabel, setExecutingNodeLabel] = useState<string | null>(null);
  const [showExecuteModal, setShowExecuteModal] = useState(false);
  const [taskInput, setTaskInput] = useState("");
  const [fileHint, setFileHint] = useState("");
  const [fileHintIsError, setFileHintIsError] = useState(false);
  const execFileRef = useRef<HTMLInputElement>(null);

  // Dynamic form states for App Preview Mode
  const [searcherUrl, setSearcherUrl] = useState("");
  const [searcherJsRender, setSearcherJsRender] = useState(true);
  const [searcherDeepScrape, setSearcherDeepScrape] = useState(false);

  const [summarizerContent, setSummarizerContent] = useState("");
  const [summarizerPurity, setSummarizerPurity] = useState("summary");
  const [summarizerKeepMetrics, setSummarizerKeepMetrics] = useState(true);

  const [coderRequirement, setCoderRequirement] = useState("");
  const [coderLanguage, setCoderLanguage] = useState("Python");
  const [coderStyle, setCoderStyle] = useState("Script");
  const [coderGenerateTests, setCoderGenerateTests] = useState(true);

  const [formatterRawData, setFormatterRawData] = useState("");
  const [formatterProtocol, setFormatterProtocol] = useState("JSON");
  const [formatterCleanWhitespace, setFormatterCleanWhitespace] = useState(true);

  const [mindCorePrompt, setMindCorePrompt] = useState("");
  const [cognitiveTemp, setCognitiveTemp] = useState(0.2);
  const [subconsciousBoost, setSubconsciousBoost] = useState(false);

  const [showDevSettings, setShowDevSettings] = useState(false);

  const [contractInput, setContractInput] = useState("");
  const [showDevDrawer, setShowDevDrawer] = useState(false);

  // 结果面板
  const [execResult, setExecResult] = useState<any>(null);
  const [showResultPanel, setShowResultPanel] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  const updateActiveTextField = (text: string) => {
    setContractInput(text);
    const role = firstNode?.data.role || "default";
    if (role === "searcher") setSearcherUrl(text);
    else if (role === "summarizer") setSummarizerContent(text);
    else if (role === "coder") setCoderRequirement(text);
    else if (role === "formatter") setFormatterRawData(text);
    else setMindCorePrompt(text);
  };

  const processUploadedFile = async (file: File) => {
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    setFileHint(t('file_reading'));
    setFileHintIsError(false);
    try {
      let text = "";
      if (ext === ".pdf") {
        const arrayBuffer = await file.arrayBuffer();
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pages: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          pages.push(content.items.map((item: any) => item.str).join(" "));
        }
        text = pages.join("\n\n");
        setFileHint(t('file_parsed_pdf_pages', { name: file.name, pages: pdf.numPages }));
        setFileHintIsError(false);
      } else if (ext === ".docx") {
        const arrayBuffer = await file.arrayBuffer();
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
        setFileHint(t('file_parsed_word_short', { name: file.name }));
        setFileHintIsError(false);
      } else if ([".doc", ".pptx", ".xlsx"].includes(ext)) {
        setFileHint(t('file_unsupported_short', { ext }));
        setFileHintIsError(true);
        return;
      } else {
        const reader = new FileReader();
        reader.onload = ev => {
          const parsed = ev.target?.result as string;
          setFileHint(t('file_read_short', { name: file.name }));
          setFileHintIsError(false);
          setTaskInput(parsed);
          setContractInput(parsed);
          updateActiveTextField(parsed);
        };
        reader.readAsText(file, "utf-8");
        return;
      }

      if (text) {
        setTaskInput(text);
        setContractInput(text);
        updateActiveTextField(text);
      }
    } catch {
      setFileHint(t('file_parse_error'));
      setFileHintIsError(true);
    }
  };

  const handleExecFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    await processUploadedFile(file);
  };

  const handleReactorLaunch = () => {
    if (!activeWorkspaceId) return;

    // Find the starting node
    const startingNodes = nodes.filter(n => !edges.some(e => e.target === n.id));
    const firstNode = startingNodes.length > 0 ? startingNodes[0] : null;

    // Check if the starting node has an input specification configured
    const needsInput = firstNode && firstNode.data?.input && firstNode.data.input.trim() !== "";

    if (needsInput) {
      const role = firstNode?.data?.role || "default";
      let initialVal = "";
      if (role === "searcher") initialVal = searcherUrl;
      else if (role === "summarizer") initialVal = summarizerContent;
      else if (role === "coder") initialVal = coderRequirement;
      else if (role === "formatter") initialVal = formatterRawData;
      else initialVal = mindCorePrompt;

      setContractInput(initialVal);
      setFileHint("");
      setShowDevDrawer(false);
      // If it requires user inputs, open the beautifully tailored App Preview Form Modal
      setShowExecuteModal(true);
    } else {
      // If it does not require any input, directly execute the workflow!
      handleExecuteWorkflow();
    }
  };

  const getCompiledPayload = () => {
    if (!firstNode) return contractInput;
    const theme = determineFormTheme(firstNode);
    let compiled = contractInput;

    if (theme === "explorer") {
      compiled = `[ENGINE OPTION - JS RENDER: ${searcherJsRender ? "ENABLED" : "DISABLED"}]\n[ENGINE OPTION - DEEP CRAWL: ${searcherDeepScrape ? "ENABLED" : "DISABLED"}]\n\nTARGET URL: ${contractInput}`;
    } else if (theme === "ide") {
      compiled = `[DEVELOPMENT LANGUAGE: ${coderLanguage}]\n[ARCHITECTURE STYLE: ${coderStyle}]\n[GENERATE TESTS: ${coderGenerateTests ? "YES" : "NO"}]\n\nCODE REQUIREMENT:\n${contractInput}`;
    } else if (theme === "intel") {
      compiled = `[EXTRACTION MODE: ${summarizerPurity === "summary" ? "EXECUTIVE SUMMARY" : summarizerPurity === "key_metrics" ? "KEY METRICS ONLY" : "FULL INTEL AUDIT"}]\n[PRESERVE METRICS: ${summarizerKeepMetrics ? "YES" : "NO"}]\n\nBRIEFING TEXT:\n${contractInput}`;
    } else if (theme === "matrix") {
      let dataToClean = contractInput;
      if (formatterCleanWhitespace) {
        dataToClean = dataToClean.trim();
      }
      compiled = `[DATA PROTOCOL: ${formatterProtocol}]\n[CLEAN WHITESPACE: ${formatterCleanWhitespace ? "YES" : "NO"}]\n\nRAW DATA PAYLOAD:\n${dataToClean}`;
    } else if (theme === "mind") {
      compiled = `[PSYCHIC RESONANCE: ${subconsciousBoost ? "CASCADE COGNITIVE RESONANCE BOOST ACTIVE" : "STANDARD COGNITIVE RESONANCE"}]\n[COGNITIVE TEMPERATURE: ${cognitiveTemp}]\n\nINDISPENSABLE INSTRUCTION:\n${contractInput}`;
    }
    return compiled;
  };

  const handleExecuteWorkflow = async () => {
    const startingNodes = nodes.filter(n => !edges.some(e => e.target === n.id));
    const firstNode = startingNodes.length > 0 ? startingNodes[0] : null;
    const compiledPayload = getCompiledPayload();

    const needsInput = firstNode && firstNode.data?.input && firstNode.data.input.trim() !== "";
    if (!activeWorkspaceId) return;
    if (needsInput && !contractInput.trim()) return;

    setIsExecuting(true);
    setExecResult(null);
    setExecutingNodeLabel(null);
    setShowExecuteModal(false);
    setShowDevDrawer(false);


    // Reset all nodes to idle first
    setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, status: "idle" } })));

    try {
      await api.updateCanvas(activeWorkspaceId, { nodes, edges });
      setCanvasData(nodes, edges);
      setHasUnsaved(false);

      const activeProfile = getActiveProfile();
      const resp = await api.executeWorkflowStream(activeWorkspaceId, {
        initial_payload: compiledPayload,
        llm_config: activeProfile ? {
          api_key: activeProfile.apiKey || null,
          base_url: activeProfile.baseUrl || null,
          model_id: activeProfile.modelId || null,
          temperature: activeProfile.temperature ?? null,
        } : null,
      });

      if (!resp.ok || !resp.body) throw new Error("Stream request failed");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          try {
            const event = JSON.parse(payload);

            if (event.type === "node_start") {
              setExecutingNodeLabel(event.label || null);
              setNodes(nds => nds.map(n => ({
                ...n,
                data: { ...n.data, status: n.id === event.node_id ? "running" : n.data.status }
              })));
            } else if (event.type === "node_done") {
              setExecutingNodeLabel(null);
              setNodes(nds => nds.map(n => ({
                ...n,
                data: { ...n.data, status: n.id === event.node_id ? "idle" : n.data.status }
              })));
            } else if (event.type === "done") {
              setExecResult({
                final_payload: event.final_payload,
                logs: event.logs,
                results_by_node: event.results_by_node,
                execution_log_id: event.execution_log_id,
              });
              setShowResultPanel(true);
              setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, status: "idle" } })));
            } else if (event.type === "error") {
              throw new Error(event.message || t('error_unknown'));
            }
          } catch (parseErr) {
            // Skip malformed SSE lines
          }
        }
      }
    } catch (err: any) {
      setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, status: "error" } })));
      setExecResult({ error: err?.message || t('execute_fail_default') });
      setShowResultPanel(true);
    } finally {
      setIsExecuting(false);
      setExecutingNodeLabel(null);
    }
  };

  const isFormValid = () => {
    if (nodes.length === 0) return false;
    const startingNodes = nodes.filter(n => !edges.some(e => e.target === n.id));
    const firstNode = startingNodes.length > 0 ? startingNodes[0] : null;
    const needsInput = firstNode && firstNode.data?.input && firstNode.data.input.trim() !== "";
    if (needsInput) {
      return contractInput.trim() !== "";
    }
    return true;
  };

  const isFormValidRef = useRef(isFormValid);
  isFormValidRef.current = isFormValid;

  const handleExecuteWorkflowRef = useRef(handleExecuteWorkflow);
  handleExecuteWorkflowRef.current = handleExecuteWorkflow;

  // Listen for Cmd/Ctrl + Enter to trigger handleExecuteWorkflow inside the execution modal
  useEffect(() => {
    if (!showExecuteModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (isFormValidRef.current() && !isExecuting && nodes.length > 0) {
          handleExecuteWorkflowRef.current();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showExecuteModal, isExecuting, nodes]);

  const renderExplorerTheme = (inputContract: string, outputContract: string) => {
    return (
      <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
        {/* Browser Mock Shell */}
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/5 overflow-hidden shadow-[0_4px_30px_rgba(16,185,129,0.03)]">
          {/* Browser Header Bar */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-950/20 border-b border-emerald-500/10">
            <div className="flex items-center space-x-1.5 shrink-0 animate-pulse">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/70 block" />
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70 block" />
              <span className="w-2.5 h-2.5 rounded-full bg-green-500/70 block" />
            </div>
            <span className="text-[10px] font-mono text-emerald-400/60 font-bold select-none tracking-widest flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
              🌐 WEB EXPLORER & CRAWLER ENGINE
            </span>
            <div className="w-12 shrink-0" />
          </div>

          <div className="p-5 space-y-4">
            <div className="relative">
              <label className="block text-xs font-mono font-bold tracking-widest text-emerald-400 uppercase mb-2 flex items-center gap-2 text-left">
                <Globe className="w-3.5 h-3.5 text-emerald-400" />
                <span>{t('searcher_target_label')}</span>
              </label>

              {/* Mock Address Bar */}
              <div className="relative flex items-center bg-black/60 border border-emerald-500/20 rounded-xl overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] focus-within:border-emerald-500/60 focus-within:ring-1 focus-within:ring-emerald-500/30 transition-all">
                <div className="flex items-center gap-1.5 px-3 border-r border-emerald-500/10 bg-emerald-950/10 text-emerald-400/70 select-none shrink-0 font-mono text-xs">
                  <Lock className="w-3 h-3 text-emerald-500" />
                  <span>https://</span>
                </div>
                <input
                  type="text"
                  value={contractInput}
                  onChange={(e) => updateActiveTextField(e.target.value)}
                  placeholder={t('searcher_input_placeholder', { contract: inputContract })}
                  className="w-full px-3 py-3 bg-transparent font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
                />
              </div>
            </div>

            {/* Custom Options Switches */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div 
                onClick={() => setSearcherJsRender(!searcherJsRender)}
                className={`flex items-center justify-between p-3.5 border rounded-xl cursor-pointer transition-all ${
                  searcherJsRender 
                    ? "border-emerald-500/40 bg-emerald-950/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]" 
                    : "border-white/5 bg-white/5 hover:bg-white/10"
                }`}
              >
                <div className="flex flex-col text-left">
                  <span className="font-mono text-xs font-bold text-slate-200 flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{t('searcher_js_render_label')}</span>
                  </span>
                  <span className="font-mono text-[9px] text-slate-500 mt-0.5">{t('searcher_js_render_desc')}</span>
                </div>
                <div className={`w-8 h-4 rounded-full p-0.5 transition-colors duration-200 shrink-0 ${searcherJsRender ? "bg-emerald-500" : "bg-zinc-800"}`}>
                  <div className={`bg-white w-3 h-3 rounded-full shadow transition-transform duration-200 ${searcherJsRender ? "translate-x-4" : ""}`} />
                </div>
              </div>

              <div 
                onClick={() => setSearcherDeepScrape(!searcherDeepScrape)}
                className={`flex items-center justify-between p-3.5 border rounded-xl cursor-pointer transition-all ${
                  searcherDeepScrape 
                    ? "border-emerald-500/40 bg-emerald-950/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]" 
                    : "border-white/5 bg-white/5 hover:bg-white/10"
                }`}
              >
                <div className="flex flex-col text-left">
                  <span className="font-mono text-xs font-bold text-slate-200 flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{t('searcher_deep_crawl_label')}</span>
                  </span>
                  <span className="font-mono text-[9px] text-slate-500 mt-0.5">{t('searcher_deep_crawl_desc')}</span>
                </div>
                <div className={`w-8 h-4 rounded-full p-0.5 transition-colors duration-200 shrink-0 ${searcherDeepScrape ? "bg-emerald-500" : "bg-zinc-800"}`}>
                  <div className={`bg-white w-3 h-3 rounded-full shadow transition-transform duration-200 ${searcherDeepScrape ? "translate-x-4" : ""}`} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Expected Outcome Card */}
        {outputContract && (
          <div className="relative rounded-xl border border-emerald-500/20 bg-emerald-950/5 p-4 shadow-[0_0_20px_rgba(16,185,129,0.03)] overflow-hidden text-left">
            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl"></div>
            <div className="flex items-center gap-2 text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest mb-2">
              <CheckCircle2 className="w-3.5 h-3.5 animate-pulse" />
              <span>{t('outcome_expected_label')}</span>
            </div>
            <div className="font-mono text-xs text-emerald-300/80 pl-5 border-l border-emerald-500/30 py-1 leading-relaxed">
              {t('searcher_outcome_desc')}
              <span className="text-emerald-200 font-bold block mt-1">
                {outputContract}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderIdeTheme = (inputContract: string, outputContract: string) => {
    return (
      <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
        {/* IDE Shell Container */}
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/5 overflow-hidden shadow-[0_4px_30px_rgba(99,102,241,0.03)] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-indigo-950/20 border-b border-indigo-500/10">
            <div className="flex items-center space-x-1.5 shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/70 block" />
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70 block" />
              <span className="w-2.5 h-2.5 rounded-full bg-green-500/70 block" />
            </div>
            <span className="text-[10px] font-mono text-indigo-400/60 font-bold select-none tracking-widest flex items-center gap-1.5">
              <Code className="w-3.5 h-3.5 text-indigo-400 animate-spin-slow" />
              💻 LOGIC COMPILER WORKSPACE
            </span>
            <div className="w-12 shrink-0" />
          </div>

          <div className="flex h-72 border-b border-indigo-500/10">
            {/* Left Mock File Tree */}
            <div className="w-44 border-r border-indigo-500/10 bg-indigo-950/5 p-4 select-none text-left shrink-0 overflow-y-auto hidden md:block">
              <span className="block text-[9px] font-bold text-indigo-400/40 uppercase tracking-widest mb-3 font-mono">WORKSPACE FILES</span>
              <div className="space-y-2.5 font-mono text-[10px] text-slate-400">
                <div className="text-indigo-400 font-bold truncate">📁 src/components</div>
                <div className="pl-3 text-slate-500 hover:text-slate-300 cursor-pointer truncate">📄 yuri_agent.py</div>
                <div className="pl-3 text-indigo-300 font-black truncate">📄 requirement.txt 🔵</div>
                <div className="pl-3 text-slate-500 hover:text-slate-300 cursor-pointer truncate">📄 utils.go</div>
                <div className="text-slate-500 font-bold truncate">📁 tests</div>
                <div className="pl-3 text-slate-500 hover:text-slate-300 cursor-pointer truncate">📄 test_flow.py</div>
              </div>
            </div>

            {/* Center Coding Editor */}
            <div className="flex-1 flex flex-col bg-black/40 text-left">
              {/* Tab Header */}
              <div className="flex bg-black/30 border-b border-indigo-500/5 h-8 items-center text-[10px] font-mono select-none">
                <div className="px-3 h-full flex items-center gap-1.5 border-r border-indigo-500/10 bg-black/60 text-slate-200 border-t border-t-indigo-500 font-bold">
                  <Code className="w-3 h-3 text-indigo-400" />
                  <span>requirement.txt</span>
                </div>
              </div>

              {/* Text Input Editor Panel */}
              <div className="flex-1 flex relative font-mono text-sm leading-relaxed overflow-hidden">
                {/* Simulated Line Numbers */}
                <div className="w-10 bg-black/20 text-indigo-500/30 text-right pr-2 py-4 select-none border-r border-indigo-500/5 text-xs font-bold leading-normal">
                  <div>1</div>
                  <div>2</div>
                  <div>3</div>
                  <div>4</div>
                  <div>5</div>
                  <div>6</div>
                  <div>7</div>
                  <div>8</div>
                </div>

                <textarea
                  value={contractInput}
                  onChange={(e) => updateActiveTextField(e.target.value)}
                  placeholder={t('coder_input_placeholder', { contract: inputContract })}
                  className="flex-1 p-4 bg-transparent border-none text-slate-200 placeholder:text-slate-700 focus:outline-none focus:ring-0 resize-none font-mono text-sm shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]"
                />
              </div>
            </div>
          </div>

          {/* Bottom Settings Bar */}
          <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-black/20 gap-3 text-left">
            <div className="flex items-center gap-3">
              {/* Language Selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-mono text-slate-500 font-bold">LANG:</span>
                <select
                  value={coderLanguage}
                  onChange={(e) => setCoderLanguage(e.target.value)}
                  className="bg-black border border-indigo-500/25 rounded px-2 py-0.5 font-mono text-[10px] text-indigo-300 focus:outline-none"
                >
                  <option value="Python">Python</option>
                  <option value="TypeScript">TypeScript</option>
                  <option value="Golang">Golang</option>
                  <option value="Rust">Rust</option>
                </select>
              </div>

              {/* Style Selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-mono text-slate-500 font-bold">STYLE:</span>
                <select
                  value={coderStyle}
                  onChange={(e) => setCoderStyle(e.target.value)}
                  className="bg-black border border-indigo-500/25 rounded px-2 py-0.5 font-mono text-[10px] text-indigo-300 focus:outline-none"
                >
                  <option value="Script">Script</option>
                  <option value="Module">Module</option>
                  <option value="Full Component">Component</option>
                </select>
              </div>
            </div>

            {/* Test Gen switch */}
            <div 
              onClick={() => setCoderGenerateTests(!coderGenerateTests)}
              className="flex items-center gap-2 cursor-pointer select-none"
            >
              <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${coderGenerateTests ? "border-indigo-500 bg-indigo-500/20 shadow-[0_0_8px_rgba(99,102,241,0.2)]" : "border-slate-600 bg-black"}`}>
                {coderGenerateTests && <Check className="w-2.5 h-2.5 text-indigo-300 font-black" />}
              </div>
              <span className="font-mono text-[10px] text-slate-300 font-bold">{t('coder_auto_tests_label')}</span>
            </div>
          </div>
        </div>

        {/* Expected Outcome Card */}
        {outputContract && (
          <div className="relative rounded-xl border border-indigo-500/20 bg-indigo-950/5 p-4 shadow-[0_0_20px_rgba(99,102,241,0.03)] overflow-hidden text-left">
            <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl"></div>
            <div className="flex items-center gap-2 text-xs font-mono font-bold text-indigo-400 uppercase tracking-widest mb-2">
              <CheckCircle2 className="w-3.5 h-3.5 animate-pulse" />
              <span>{t('outcome_expected_label')}</span>
            </div>
            <div className="font-mono text-xs text-indigo-300/80 pl-5 border-l border-indigo-500/30 py-1 leading-relaxed">
              {t('coder_outcome_desc')}
              <span className="text-indigo-200 font-bold block mt-1">
                {outputContract}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderIntelTheme = (inputContract: string, outputContract: string) => {
    return (
      <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
        {/* Document Briefcase Container */}
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/5 p-5 shadow-[0_4px_30px_rgba(6,182,212,0.03)] space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-cyan-500/10 text-left">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-cyan-400" />
              <span className="font-mono text-xs font-bold text-cyan-400 tracking-wider">📚 INTEL BRIEFING & TEXT DIGEST</span>
            </div>
            <span className="text-[10px] font-mono text-cyan-400/40 select-none">Briefing Folder Mode</span>
          </div>

          {/* Quick upload zone */}
          <div 
            onClick={() => execFileRef.current?.click()}
            className="group border border-dashed border-cyan-500/20 rounded-xl bg-cyan-950/5 p-4.5 text-center cursor-pointer transition-all hover:bg-cyan-500/10 hover:border-cyan-500/50 shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]"
          >
            <Upload className="h-5 w-5 mx-auto mb-2 text-cyan-500/50 group-hover:text-cyan-400 transition-all" />
            <p className="font-mono text-xs text-slate-300 font-bold">{t('intel_upload_title')}</p>
            <p className="font-mono text-[9px] text-slate-500 mt-1">{t('intel_upload_formats')}</p>
          </div>

          <div className="relative">
            <label className="block text-xs font-mono font-bold tracking-widest text-cyan-400/80 uppercase mb-2 flex items-center gap-2 text-left">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>{t('intel_input_label', { contract: inputContract })}</span>
            </label>

            <textarea
              value={contractInput}
              onChange={(e) => updateActiveTextField(e.target.value)}
              placeholder={t('intel_input_placeholder', { contract: inputContract })}
              rows={8}
              className="w-full p-4 bg-black/40 border border-cyan-500/20 hover:border-cyan-500/45 rounded-xl font-sans text-sm text-slate-100 placeholder:text-slate-650 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500/30 transition-all resize-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] leading-relaxed"
            />
          </div>

          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between pt-2 border-t border-cyan-500/10 gap-3 text-left">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-slate-500 font-bold">{t('intel_purity_label')}</span>
              <select
                value={summarizerPurity}
                onChange={(e) => setSummarizerPurity(e.target.value)}
                className="bg-black border border-cyan-500/25 rounded px-2 py-0.5 font-mono text-[10px] text-cyan-300 focus:outline-none"
              >
                <option value="summary">{t('intel_purity_summary')}</option>
                <option value="key_metrics">{t('intel_purity_metrics')}</option>
                <option value="full_audit">{t('intel_purity_full')}</option>
              </select>
            </div>

            <div 
              onClick={() => setSummarizerKeepMetrics(!summarizerKeepMetrics)}
              className="flex items-center gap-2 cursor-pointer select-none"
            >
              <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${summarizerKeepMetrics ? "border-cyan-500 bg-cyan-500/20" : "border-slate-600 bg-black"}`}>
                {summarizerKeepMetrics && <Check className="w-2.5 h-2.5 text-cyan-300 font-bold" />}
              </div>
              <span className="font-mono text-[10px] text-slate-300 font-bold">{t('intel_keep_metrics_label')}</span>
            </div>
          </div>
        </div>

        {/* Expected Outcome Card */}
        {outputContract && (
          <div className="relative rounded-xl border border-cyan-500/20 bg-cyan-950/5 p-4 shadow-[0_0_20px_rgba(6,182,212,0.03)] overflow-hidden text-left">
            <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-2xl"></div>
            <div className="flex items-center gap-2 text-xs font-mono font-bold text-cyan-400 uppercase tracking-widest mb-2">
              <CheckCircle2 className="w-3.5 h-3.5 animate-pulse" />
              <span>{t('outcome_expected_label')}</span>
            </div>
            <div className="font-mono text-xs text-cyan-300/80 pl-5 border-l border-cyan-500/30 py-1 leading-relaxed">
              {t('intel_outcome_desc')}
              <span className="text-cyan-200 font-bold block mt-1">
                {outputContract}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderMatrixTheme = (inputContract: string, outputContract: string) => {
    const handlePrettifyJson = () => {
      try {
        const parsed = JSON.parse(contractInput);
        const pretty = JSON.stringify(parsed, null, 2);
        updateActiveTextField(pretty);
      } catch (e) {
        // Skip
      }
    };

    const isValidJson = (() => {
      if (!contractInput.trim()) return true;
      try {
        JSON.parse(contractInput);
        return true;
      } catch {
        return false;
      }
    })();

    return (
      <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
        {/* Data Console Container */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-950/5 p-5 shadow-[0_4px_30px_rgba(245,158,11,0.03)] space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-amber-500/10 text-left">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-amber-400" />
              <span className="font-mono text-xs font-bold text-amber-400 tracking-wider">📊 DATA REFINING MATRIX PANEL</span>
            </div>
            <span className="text-[10px] font-mono text-amber-400/40 select-none">Data Refining Pipeline</span>
          </div>

          <div className="relative">
            <div className="flex justify-between items-center mb-2">
              <label className="block text-xs font-mono font-bold tracking-widest text-amber-400/80 uppercase flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>{t('matrix_input_label', { contract: inputContract })}</span>
              </label>

              {/* Prettify Action */}
              <button
                type="button"
                onClick={handlePrettifyJson}
                disabled={!contractInput.trim() || !isValidJson}
                className="px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono text-[9px] hover:bg-amber-500/20 disabled:opacity-40 transition-all flex items-center gap-1 cursor-pointer"
              >
                <span>{t('matrix_prettify_btn')}</span>
              </button>
            </div>

            <div className="relative">
              <textarea
                value={contractInput}
                onChange={(e) => updateActiveTextField(e.target.value)}
                placeholder={t('matrix_input_placeholder', { contract: inputContract })}
                rows={8}
                className={`w-full p-4 bg-black/40 border rounded-xl font-mono text-xs placeholder:text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-all resize-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] ${
                  isValidJson 
                    ? "border-amber-500/20 focus:border-amber-500 hover:border-amber-500/40 text-slate-100" 
                    : "border-red-500/40 focus:border-red-500 hover:border-red-500/50 text-red-200"
                }`}
              />
              {!isValidJson && (
                <div className="absolute bottom-3 right-3 text-[9px] font-mono text-red-400 bg-red-950/60 px-2 py-0.5 border border-red-500/20 rounded select-none animate-pulse">
                  {t('matrix_json_error')}
                </div>
              )}
            </div>
          </div>

          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between pt-2 border-t border-amber-500/10 gap-3 text-left">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-slate-500 font-bold">{t('matrix_protocol_label')}</span>
              <select
                value={formatterProtocol}
                onChange={(e) => setFormatterProtocol(e.target.value)}
                className="bg-black border border-amber-500/25 rounded px-2 py-0.5 font-mono text-[10px] text-amber-300 focus:outline-none"
              >
                <option value="JSON">{t('matrix_fmt_json')}</option>
                <option value="XML">{t('matrix_fmt_xml')}</option>
                <option value="CSV">{t('matrix_fmt_csv')}</option>
                <option value="RAW">{t('matrix_fmt_raw')}</option>
              </select>
            </div>

            <div 
              onClick={() => setFormatterCleanWhitespace(!formatterCleanWhitespace)}
              className="flex items-center gap-2 cursor-pointer select-none"
            >
              <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${formatterCleanWhitespace ? "border-amber-500 bg-amber-500/20" : "border-slate-600 bg-black"}`}>
                {formatterCleanWhitespace && <Check className="w-2.5 h-2.5 text-amber-300 font-black" />}
              </div>
              <span className="font-mono text-[10px] text-slate-300 font-bold">{t('matrix_clean_spaces_label')}</span>
            </div>
          </div>
        </div>

        {/* Expected Outcome Card */}
        {outputContract && (
          <div className="relative rounded-xl border border-amber-500/20 bg-amber-950/5 p-4 shadow-[0_0_20px_rgba(245,158,11,0.03)] overflow-hidden text-left">
            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl"></div>
            <div className="flex items-center gap-2 text-xs font-mono font-bold text-amber-400 uppercase tracking-widest mb-2">
              <CheckCircle2 className="w-3.5 h-3.5 animate-pulse" />
              <span>{t('outcome_expected_label')}</span>
            </div>
            <div className="font-mono text-xs text-amber-300/80 pl-5 border-l border-amber-500/30 py-1 leading-relaxed">
              {t('matrix_outcome_desc')}
              <span className="text-amber-200 font-bold block mt-1">
                {outputContract}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderMindTheme = (inputContract: string, outputContract: string) => {
    return (
      <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
        {/* Mind Orb Visualizer & Cosmic Dialogue Panel */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 shadow-[0_4px_30px_rgba(168,85,247,0.03)] relative overflow-hidden flex flex-col items-center">
          {/* Breathing SVG Aura Orb Background */}
          <div className="w-48 h-48 my-2 relative flex items-center justify-center shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full animate-[spin_40s_linear_infinite]">
              <defs>
                <radialGradient id="auraGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="oklch(0.60 0.25 290 / 60%)" />
                  <stop offset="50%" stopColor="oklch(0.40 0.20 290 / 20%)" />
                  <stop offset="100%" stopColor="oklch(0.12 0 0 / 0%)" />
                </radialGradient>
              </defs>
              <circle cx="50" cy="50" r="45" fill="url(#auraGlow)" className="animate-[pulse_4s_ease-in-out_infinite]" />
              <circle cx="50" cy="50" r="30" fill="none" stroke="oklch(0.60 0.25 290 / 40%)" strokeWidth="0.5" strokeDasharray="3 3" />
              <circle cx="50" cy="50" r="20" fill="none" stroke="oklch(0.60 0.25 290 / 60%)" strokeWidth="0.8" strokeDasharray="10 5" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <BrainCircuit className="w-10 h-10 text-white drop-shadow-[0_0_12px_oklch(0.60 0.25 290)] animate-pulse" />
            </div>
          </div>

          <div className="w-full text-left space-y-3 z-10 relative">
            <label className="block text-xs font-mono font-bold tracking-widest text-primary/80 uppercase flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span>{t('mind_input_label', { contract: inputContract })}</span>
            </label>

            <div className="relative">
              <textarea
                value={contractInput}
                onChange={(e) => updateActiveTextField(e.target.value)}
                placeholder={t('mind_input_placeholder', { contract: inputContract })}
                rows={4}
                className="w-full p-4 bg-black/50 border border-primary/20 hover:border-primary/45 rounded-xl font-mono text-sm text-slate-100 placeholder:text-slate-655 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all resize-none shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] leading-relaxed"
              />
            </div>

            {/* Cognitive Resonance Controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-white/5">
              {/* Cognitive Temp */}
              <div className="space-y-1 bg-white/5 border border-white/5 rounded-xl p-3 flex flex-col justify-center">
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span className="font-bold">{t('mind_temp_label')}</span>
                  <span className="text-primary font-bold">{cognitiveTemp}</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={cognitiveTemp}
                  onChange={(e) => setCognitiveTemp(parseFloat(e.target.value))}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none mt-1.5"
                />
              </div>

              {/* Psychic Resonator switch */}
              <div 
                onClick={() => setSubconsciousBoost(!subconsciousBoost)}
                className={`flex items-center justify-between p-3 border rounded-xl cursor-pointer transition-all ${
                  subconsciousBoost 
                    ? "border-primary/50 bg-primary/10 shadow-[0_0_15px_rgba(153,51,255,0.15)]" 
                    : "border-white/5 bg-white/5 hover:bg-white/10"
                }`}
              >
                <div className="flex flex-col">
                  <span className="font-mono text-xs font-bold text-slate-200">{t('mind_resonance_label')}</span>
                  <span className="font-mono text-[8px] text-slate-500">{t('mind_resonance_desc')}</span>
                </div>
                <div className={`w-8 h-4 rounded-full p-0.5 transition-colors duration-200 shrink-0 ${subconsciousBoost ? "bg-primary" : "bg-slate-700"}`}>
                  <div className={`bg-white w-3 h-3 rounded-full shadow transition-transform duration-200 ${subconsciousBoost ? "translate-x-4" : ""}`} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Expected Outcome Card */}
        {outputContract && (
          <div className="relative rounded-xl border border-primary/20 bg-primary/5 p-4 shadow-[0_0_20px_rgba(168,85,247,0.03)] overflow-hidden text-left">
            <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl"></div>
            <div className="flex items-center gap-2 text-xs font-mono font-bold text-primary uppercase tracking-widest mb-2">
              <CheckCircle2 className="w-3.5 h-3.5 animate-pulse" />
              <span>{t('outcome_expected_label')}</span>
            </div>
            <div className="font-mono text-xs text-primary/80 pl-5 border-l border-primary/30 py-1 leading-relaxed">
              {t('mind_outcome_desc')}
              <span className="text-white font-bold block mt-1">
                {outputContract}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderContractDrivenForm = () => {
    if (!firstNode) return null;
    const theme = determineFormTheme(firstNode);
    const inputContract = firstNode.data?.input || "";
    const outputContract = firstNode.data?.output || "";

    switch (theme) {
      case "explorer":
        return renderExplorerTheme(inputContract, outputContract);
      case "ide":
        return renderIdeTheme(inputContract, outputContract);
      case "intel":
        return renderIntelTheme(inputContract, outputContract);
      case "matrix":
        return renderMatrixTheme(inputContract, outputContract);
      case "mind":
      default:
        return renderMindTheme(inputContract, outputContract);
    }
  };

  const selectedNodeData = nodes.find((n) => n.id === selectedNodeId)?.data;

  const isEmpty = nodes.length === 0;

  return (
    <div className="h-full w-full bg-background crt relative" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode={["Delete", "Backspace"]}
        connectionRadius={40}
        connectionMode={ConnectionMode.Loose}
        onInit={(instance) => { rfInstanceRef.current = instance; (window as any).__rfInit = Date.now(); }}
        minZoom={0.1}
        className="yuri-flow"
      >
        <Background 
          variant={BackgroundVariant.Cross} 
          gap={24} 
          size={2} 
          color="oklch(0.60 0.25 290 / 20%)" 
        />
        <Controls 
          className="bg-background/80 border border-primary/30 backdrop-blur-md [&>button]:border-primary/20 [&>button]:text-primary [&>button]:hover:bg-primary/20" 
        />
        <MiniMap 
          nodeColor="oklch(0.60 0.25 290)" 
          maskColor="oklch(0.12 0 0 / 80%)" 
          className="bg-background/90 border border-primary/30 backdrop-blur-md" 
        />
      </ReactFlow>

      {/* 空画板引导 */}
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-center space-y-3 opacity-40">
            <MousePointer2 className="h-12 w-12 text-primary mx-auto" />
            <p className="font-mono text-primary text-sm tracking-widest">{t('canvas_empty_hint1')}</p>
            <p className="font-mono text-primary/60 text-xs">{t('canvas_empty_hint2')}</p>
          </div>
        </div>
      )}

      {/* 左侧：特工兵营 */}
      <AgentLibrary onSyncAgents={handleSyncAgents} isSyncing={isSyncing} />

      {/* 顶部中央：保存与执行按钮组 */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex space-x-4">
        <button
          onClick={handleSaveCanvas}
          disabled={isSaving || !activeWorkspaceId}
          className={`flex items-center space-x-2 px-6 py-2.5 font-mono text-sm font-bold tracking-widest rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-md ${
            hasUnsaved && activeWorkspaceId
              ? "bg-yellow-500/20 border border-yellow-400/80 text-yellow-300 shadow-[0_0_20px_rgba(234,179,8,0.4)] hover:bg-yellow-500/30"
              : "bg-card/90 border border-primary/50 text-primary shadow-[0_0_20px_rgba(153,51,255,0.2)] hover:bg-primary/20"
          }`}
        >
          <Save className="w-4 h-4" />
          <span>
            {!activeWorkspaceId ? t('btn_no_workspace') : isSaving ? t('btn_saving') : hasUnsaved ? t('btn_save_unsaved') : t('btn_save_canvas')}
          </span>
        </button>
        <button
          onClick={handleReactorLaunch}
          disabled={isExecuting || !activeWorkspaceId}
          className="flex items-center space-x-2 px-6 py-2.5 bg-primary/20 border border-primary text-white font-mono text-sm font-bold tracking-widest rounded-full shadow-[0_0_20px_rgba(153,51,255,0.4)] hover:bg-primary hover:text-black hover:shadow-[0_0_30px_rgba(153,51,255,0.8)] transition-all disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-md"
        >
          <Play className="w-4 h-4" />
          <span>{!activeWorkspaceId ? t('btn_workspace_offline') : isExecuting ? t('btn_executing') : t('btn_execute')}</span>
        </button>
        <button
          onClick={() => {
            if (!activeWorkspaceId || nodes.length === 0) return;
            // Native browser download — backend sets Content-Disposition. Use anchor to avoid window/tab popup.
            const a = document.createElement('a');
            a.href = api.exportWorkflowUrl(activeWorkspaceId);
            a.download = `yurios_workspace_${activeWorkspaceId}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }}
          disabled={!activeWorkspaceId || nodes.length === 0}
          title={t('btn_export_docker_tooltip')}
          className="flex items-center space-x-2 px-5 py-2.5 bg-card/90 border border-cyan-400/60 text-cyan-300 font-mono text-sm font-bold tracking-widest rounded-full shadow-[0_0_20px_rgba(6,182,212,0.2)] hover:bg-cyan-500/20 hover:text-cyan-100 hover:shadow-[0_0_25px_rgba(6,182,212,0.5)] transition-all disabled:opacity-40 disabled:cursor-not-allowed backdrop-blur-md"
        >
          <Package className="w-4 h-4" />
          <span>{t('btn_export_docker')}</span>
        </button>
        <button
          onClick={() => {
            setIsSidepanelOpen(!isSidepanelOpen);
            if (!isSidepanelOpen) {
              setSelectedNodeId(null);
            }
          }}
          className={`relative flex items-center space-x-2 px-6 py-2.5 font-mono text-sm font-bold tracking-widest rounded-full transition-all backdrop-blur-md ${
            isSidepanelOpen
              ? "bg-primary/30 border border-primary text-primary shadow-[0_0_20px_rgba(153,51,255,0.6)]"
              : "bg-card/90 border border-primary/50 text-primary/80 shadow-[0_0_20px_rgba(153,51,255,0.2)] hover:bg-primary/20 hover:text-primary"
          }`}
        >
          <BrainCircuit className="w-4 h-4" />
          <span>{t('btn_commander')}</span>
          {activeSession?.pendingPlan && !activeSession.deployed && (
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
          )}
        </button>
        {execResult && !showResultPanel && !isExecuting && (
          <button
            onClick={() => setShowResultPanel(true)}
            className="flex items-center space-x-2 px-4 py-2.5 bg-green-500/10 border border-green-500/50 text-green-400 font-mono text-sm font-bold tracking-widest rounded-full hover:bg-green-500/20 transition-all backdrop-blur-md"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{t('btn_last_result')}</span>
          </button>
        )}
      </div>

      {/* 右侧：情报与指令配置终端 */}
      <AgentConfigPanel 
        nodeId={selectedNodeId} 
        nodeData={selectedNodeData} 
        onClose={() => setSelectedNodeId(null)}
        onUpdate={handleNodeUpdate}
        onDelete={handleDeleteNode}
      />

      {/* 操作提示 */}
      <div className="absolute bottom-4 left-72 z-10 flex items-start gap-1.5 px-3 py-2 rounded-lg bg-muted/60 border border-white/10 backdrop-blur-sm text-[10px] font-mono text-slate-500">
        <Info className="h-3 w-3 mt-0.5 shrink-0 text-white/45" />
        <div className="space-y-0.5">
          <div><span className="text-primary/60">{t('help_connect')}</span>{t('help_connect_desc')}</div>
          <div><span className="text-primary/60">{t('help_delete_edge')}</span>{t('help_delete_edge_desc')}</div>
          <div><span className="text-primary/60">{t('help_delete_node')}</span>{t('help_delete_node_desc')}</div>
        </div>
      </div>

      {/* 任务输入抽屉 — 从底部滑入，不遮挡画板 */}
      {/* 任务输入抽屉 — 全屏高级玻璃拟态 UI (App Preview Screen) */}
      {showExecuteModal && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/90 backdrop-blur-md p-6 animate-in fade-in duration-200 overflow-hidden">
          {/* Centered Form Card */}
          <div className="relative w-full max-w-2xl bg-zinc-900/60 border border-white/10 rounded-2xl shadow-[0_0_50px_rgba(168,85,247,0.15)] flex flex-col p-8 transition-all duration-300">
            {/* Header */}
            <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-primary/10 border border-primary/30 rounded-xl">
                  <BrainCircuit className="w-6 h-6 text-primary animate-pulse" />
                </div>
                <div>
                  <h2 className="text-lg font-mono font-black text-white tracking-wider flex items-center gap-2">
                    {firstNode ? firstNode.data.label : t('execute_modal_workflow_reactor')}
                  </h2>
                  <p className="text-[10px] font-mono text-slate-400 tracking-wider mt-0.5">
                    {firstNode?.data.description || t('workflow_form_desc')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                  <span>{t('execute_modal_ready')}</span>
                </div>
                <button 
                  onClick={() => { setShowExecuteModal(false); setFileHint(""); setShowDevDrawer(false); }} 
                  className="p-2 rounded-lg border border-white/5 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Content Form Body */}
            <div className="flex-1 overflow-y-auto pr-1">
              {renderContractDrivenForm()}
            </div>

            {/* Action Area */}
            <div className="mt-8 pt-4 border-t border-white/10 space-y-3">
              <button
                onClick={handleExecuteWorkflow}
                disabled={!isFormValid() || isExecuting || nodes.length === 0}
                className="w-full py-4 rounded-xl border border-primary bg-primary/20 hover:bg-primary hover:text-black shadow-[0_0_20px_rgba(168,85,247,0.2)] hover:shadow-[0_0_30px_rgba(168,85,247,0.5)] text-white font-mono text-sm font-black tracking-widest transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>{t('btn_assembling')}</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 text-white" />
                    <span>{t('btn_execute_workflow')}</span>
                  </>
                )}
              </button>

              <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pt-1">
                <span>{t('contract_verified')}</span>
                <button
                  type="button"
                  onClick={() => setShowDevDrawer(true)}
                  className="text-primary hover:text-primary/80 flex items-center gap-1 cursor-pointer transition-all bg-transparent border-none p-0"
                >
                  <Sliders className="w-3.5 h-3.5 animate-pulse" />
                  <span>{t('btn_advanced_control')}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Slide-in Developer Config Drawer */}
          <div 
            className={`absolute top-0 right-0 bottom-0 w-[380px] z-40 flex flex-col bg-zinc-950/90 backdrop-blur-2xl border-l border-white/10 shadow-2xl p-6 transition-all duration-300 ease-in-out ${
              showDevDrawer ? "translate-x-0" : "translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-primary animate-pulse" />
                <span className="font-mono font-black text-xs text-white tracking-widest uppercase">{t('advanced_drawer_title')}</span>
              </div>
              <button 
                onClick={() => setShowDevDrawer(false)} 
                className="p-1 rounded bg-white/5 border border-white/5 text-slate-500 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Scrollable controls */}
            <div className="flex-1 overflow-y-auto py-6 space-y-6">
              {/* Profile/Model Engine Selector */}
              <div className="space-y-2 text-left">
                <label className="block text-[10px] font-mono font-bold text-slate-400 tracking-wider">
                  PSYCHIC COGNITIVE ENGINE // 脑波解算引擎
                </label>
                <select
                  value={activeProfileId}
                  onChange={e => setActiveProfileId(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2.5 font-mono text-xs text-white focus:outline-none focus:border-primary/50 transition-all"
                >
                  {llmProfiles.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Slider for temp */}
              <div className="space-y-4 bg-white/5 border border-white/5 rounded-xl p-4 text-left">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-[10px] font-mono font-bold text-slate-400 tracking-wider">
                      COGNITIVE TEMP // {t('dev_temp_label')}
                    </label>
                    <span className="font-mono text-xs text-primary font-bold">{cognitiveTemp}</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={cognitiveTemp}
                    onChange={(e) => setCognitiveTemp(parseFloat(e.target.value))}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none"
                  />
                </div>

                <div 
                  onClick={() => setSubconsciousBoost(!subconsciousBoost)}
                  className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-all ${
                    subconsciousBoost 
                      ? "border-primary/50 bg-primary/10 shadow-[0_0_15px_rgba(153,51,255,0.15)]" 
                      : "border-white/5 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-mono text-xs font-bold text-white">{t('dev_resonator_label')}</span>
                    <span className="font-mono text-[9px] text-slate-500">{t('dev_resonator_desc')}</span>
                  </div>
                  <div className={`w-8 h-4 rounded-full p-0.5 transition-colors duration-200 ${subconsciousBoost ? "bg-primary" : "bg-slate-700"}`}>
                    <div className={`bg-white w-3 h-3 rounded-full shadow-md transform transition-transform duration-200 ${subconsciousBoost ? "translate-x-4" : ""}`} />
                  </div>
                </div>
              </div>

              {/* Document Memory Injector */}
              <div className="space-y-2 text-left">
                <label className="block text-[10px] font-mono font-bold text-slate-400 tracking-wider">
                  DOCUMENT MEMORY INJECTOR // 外部文档思维注入
                </label>
                <div 
                  onClick={() => execFileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const file = e.dataTransfer.files?.[0];
                    if (file) {
                      await processUploadedFile(file);
                    }
                  }}
                  className="group border border-dashed border-white/10 rounded-lg bg-black/40 p-4 text-center cursor-pointer transition-all hover:bg-white/5 hover:border-primary/45"
                >
                  <Upload className="h-5 w-5 mx-auto mb-2 text-slate-500 group-hover:text-primary transition-all" />
                  <p className="font-mono text-[10px] text-slate-300 font-bold">{t('dev_upload_title')}</p>
                  <p className="font-mono text-[8px] text-slate-500 mt-1">{t('dev_upload_formats')}</p>
                </div>
                <input 
                  ref={execFileRef} 
                  type="file" 
                  accept=".txt,.md,.csv,.json,.pdf,.docx,.doc" 
                  className="hidden" 
                  onChange={handleExecFileUpload} 
                />
                {fileHint && (
                  <div className={`text-[10px] font-mono p-2.5 rounded-lg border mt-2 flex items-start gap-2 ${
                    fileHintIsError
                      ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" 
                      : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                  }`}>
                    <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span className="leading-tight">{fileHint}</span>
                  </div>
                )}
              </div>

              {/* Raw Payload Compiler Preview */}
              <div className="space-y-2 text-left">
                <span className="block text-[9px] font-mono text-slate-500 uppercase tracking-widest">Compiled Command Payload // {t('dev_payload_preview')}</span>
                <textarea
                  readOnly
                  value={getCompiledPayload()}
                  rows={6}
                  className="w-full p-2.5 bg-black border border-white/10 rounded-lg font-mono text-[11px] text-slate-400 focus:outline-none resize-none leading-normal"
                />
              </div>
            </div>

            {/* Footer details */}
            <div className="border-t border-white/10 pt-4 shrink-0 text-left">
              <div className="grid grid-cols-2 gap-2 text-[9px] font-mono text-slate-500">
                <div>{t('dev_footer_status')} <span className={nodes.length > 0 ? "text-emerald-500" : "text-red-500"}>{nodes.length > 0 ? t('dev_footer_assembled') : t('dev_footer_empty')}</span></div>
                <div>{t('dev_footer_network')} <span className="text-emerald-500">{t('dev_footer_channel')}</span></div>
                <div>{t('dev_footer_address')} <span className="text-purple-400">127.0.0.1:8000</span></div>
                <div>{t('dev_footer_level')} <span className="text-yellow-400">{t('dev_footer_level_val')}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 执行中状态条 */}
      {isExecuting && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
          <div className="flex items-center gap-3 px-6 py-3 rounded-full bg-background/95 border border-primary/50 shadow-[0_0_30px_rgba(153,51,255,0.4)] backdrop-blur-md">
            <Loader2 className="h-4 w-4 text-primary animate-spin" />
            <span className="font-mono text-sm text-primary tracking-widest animate-pulse">
              {executingNodeLabel ? t('executing_node_label', { node: executingNodeLabel }) : t('initializing_status')}
            </span>
          </div>
        </div>
      )}

      {/* 执行结果面板 */}
      {execResult && showResultPanel && (
        <div className="absolute top-4 right-4 bottom-4 z-20 w-96 flex flex-col rounded-xl border border-primary/40 bg-card/95 backdrop-blur-xl shadow-[0_0_40px_rgba(153,51,255,0.2)] animate-in slide-in-from-right-4 duration-300">
          {/* 标题 */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-primary/20 shrink-0">
            <div className="flex items-center gap-2">
              {execResult.error
                ? <AlertCircle className="h-4 w-4 text-red-400" />
                : <CheckCircle2 className="h-4 w-4 text-green-400" />}
              <span className="font-mono font-bold text-sm text-white">
                {execResult.error ? t('result_panel_error') : t('result_panel_success')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!execResult.error && (
                <button
                  onClick={() => router.push("/logs")}
                  className="flex items-center gap-1 text-[11px] font-mono text-primary/60 hover:text-primary transition-colors"
                >
                  {t('btn_full_report')} <ExternalLink className="h-3 w-3" />
                </button>
              )}
              <button onClick={() => setShowResultPanel(false)} className="text-slate-500 hover:text-white transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
            {execResult.error ? (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 font-mono text-xs leading-relaxed">
                {execResult.error}
              </div>
            ) : (
              <>
                {/* 最终输出 */}
                <div className="space-y-2">
                  <span className="text-[10px] font-mono text-green-400/60 uppercase tracking-wider font-bold">{t('final_output_label')}</span>
                  <div className="bg-background/95 border border-green-500/20 rounded-lg p-3 font-mono text-xs text-green-400/90 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto custom-scrollbar">
                    {execResult.final_payload || t('no_output')}
                  </div>
                </div>

                {/* 各节点结果 */}
                {execResult.results_by_node && Object.keys(execResult.results_by_node).length > 0 && (
                  <div className="space-y-2">
                    <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider font-bold">{t('node_outputs_label')}</span>
                    {Object.entries(execResult.results_by_node).map(([nodeId, output]: [string, any]) => {
                      const node = nodes.find(n => n.id === nodeId);
                      const label = node?.data?.label || nodeId;
                      const isExpanded = expandedNodes[nodeId];
                      return (
                        <div key={nodeId} className="border border-white/10 rounded-lg overflow-hidden">
                          <button
                            onClick={() => setExpandedNodes(prev => ({ ...prev, [nodeId]: !prev[nodeId] }))}
                            className="w-full flex items-center justify-between px-3 py-2 bg-white/5 hover:bg-white/10 transition-colors text-left"
                          >
                            <span className="font-mono text-xs text-white font-bold truncate">{label as string}</span>
                            {isExpanded ? <ChevronDown className="h-3 w-3 text-slate-500 shrink-0" /> : <ChevronRight className="h-3 w-3 text-slate-500 shrink-0" />}
                          </button>
                          {isExpanded && (
                            <div className="p-3 bg-muted/40 font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto custom-scrollbar">
                              {output as string}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* 协同主脑控制面板 (Commander Sidepanel) */}
      {isSidepanelOpen && (
        <div className="absolute top-4 right-4 z-20 w-[420px] h-[calc(100vh-6rem)] rounded-xl border border-primary/40 bg-zinc-950/90 shadow-[0_0_40px_rgba(153,51,255,0.25)] backdrop-blur-xl animate-in slide-in-from-right duration-300 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-primary/20 shrink-0 bg-primary/10">
            <h3 className="font-mono text-sm font-bold text-primary tracking-widest flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 animate-pulse" />
              <span>{t('commander_sidepanel_title')}</span>
            </h3>
            <button
              onClick={() => setIsSidepanelOpen(false)}
              className="text-white/55 hover:text-primary transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages list */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
            {!activeSession ? (
              <div className="flex items-center justify-center h-full text-white/35 font-mono text-xs">
                {t('initializing_mind_link')}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-start space-x-3 mb-2 border-b border-white/5 pb-3">
                  <div className="flex-shrink-0 h-10 w-10 rounded-full border border-primary flex items-center justify-center shadow-[0_0_10px_rgba(153,51,255,0.4)] bg-primary/5">
                    <BrainCircuit className="h-5 w-5 text-primary animate-pulse" />
                  </div>
                  <div className="flex flex-col justify-center">
                    <h4 className="text-xs font-mono font-bold tracking-widest text-primary">{t('commander_panel_title2')}</h4>
                    <p className="text-[9px] font-mono text-white/40 tracking-wider">{t('commander_panel_subtitle2')}</p>
                  </div>
                </div>

                {activeSession.messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`whitespace-pre-wrap rounded-lg p-3 font-mono text-xs leading-relaxed border ${
                      msg.role === 'user'
                        ? 'text-white bg-primary/10 border-primary/30 ml-8'
                        : msg.content.includes('[错误]') || msg.content.includes('[ERROR]')
                        ? 'text-red-400 bg-red-950/20 border-red-500/30'
                        : 'text-primary/90 bg-black/40 border-white/5'
                    }`}
                  >
                    {msg.role === 'user' && (
                      <span className="text-primary/60 text-[9px] block mb-1 font-bold">{t('commander_label2')}</span>
                    )}
                    {msg.role === 'system' && (
                      <span className="text-secondary/60 text-[9px] block mb-1 font-bold">{t('brain_feedback')}</span>
                    )}
                    {msg.content}
                  </div>
                ))}

                {isSideProcessing && (
                  <div className="text-primary/60 animate-pulse flex items-center gap-2 p-3 font-mono text-xs">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t('brain_processing')}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Action Zone (Diff Preview & Buttons, Form Input) */}
          <div className="p-4 bg-primary/5 border-t border-primary/20 flex flex-col gap-3 shrink-0">
            {activeSession?.pendingPlan && !activeSession.deployed && (
              <div className="flex flex-col w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="h-44 w-full rounded-lg overflow-hidden border border-primary/30 bg-black/50 mb-2 relative">
                  <MiniCanvas nodes={activeSession.pendingPlan.nodes} edges={activeSession.pendingPlan.edges} />
                  <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/80 border border-primary/30 rounded text-[9px] font-mono text-primary font-bold tracking-widest z-10">
                    {t('diff_preview_badge')}
                  </div>
                </div>
                <div className="flex items-center space-x-3 mt-1">
                  <button
                    onClick={handleSideConfirmDeployment}
                    disabled={isSideProcessing}
                    className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 font-mono text-xs font-bold border border-emerald-500/50 hover:bg-emerald-500 hover:text-black hover:shadow-[0_0_15px_rgba(16,185,129,0.8)] transition-all tracking-widest disabled:opacity-50 flex items-center justify-center gap-1.5 rounded-lg"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {t('confirm_deploy')}
                  </button>
                  <button
                    onClick={handleSideAbortDeployment}
                    disabled={isSideProcessing}
                    className="flex-1 py-2 bg-red-500/20 text-red-400 font-mono text-xs font-bold border border-red-500/50 hover:bg-red-500 hover:text-white hover:shadow-[0_0_15px_rgba(239,68,68,0.8)] transition-all tracking-widest disabled:opacity-50 flex items-center justify-center gap-1.5 rounded-lg"
                  >
                    <X className="h-3.5 w-3.5" />
                    {t('abort_action')}
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleSideTransmit} className="flex items-center space-x-2 w-full">
              <span className="text-primary font-mono font-bold text-sm shrink-0">{'>'}</span>
              <input
                type="text"
                value={sideInput}
                onChange={e => setSideInput(e.target.value)}
                disabled={isSideProcessing || !activeSession}
                className="flex-1 bg-black/60 border border-primary/20 focus:border-primary/50 rounded-lg px-3 py-2 font-mono text-xs text-foreground focus:outline-none placeholder:text-white/35 disabled:opacity-50"
                placeholder={
                  !activeSession ? t('initializing') :
                  activeSession.pendingPlan ? t('placeholder_adjust') :
                  t('placeholder_microadjust')
                }
              />
              <button
                type="submit"
                disabled={isSideProcessing || !activeSession || !sideInput.trim()}
                className="px-4 py-2 bg-primary/20 text-primary font-mono text-xs font-bold border border-primary/50 hover:bg-primary hover:text-black hover:shadow-[0_0_15px_rgba(153,51,255,0.8)] transition-all tracking-widest disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shrink-0"
              >
                {activeSession?.pendingPlan ? t('btn_modify_sidepanel') : t('btn_send_sidepanel')}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
