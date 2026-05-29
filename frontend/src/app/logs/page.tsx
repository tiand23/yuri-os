"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/api";
import { Activity, Clock, ServerCrash, CheckCircle2, ChevronRight, Terminal, ArrowDown, Cpu, Code, Search, Database, BrainCircuit, PenLine, ChevronDown, AlertTriangle } from "lucide-react";
import { useT } from "@/lib/useT";

const NODE_OUTPUT_COLLAPSE_THRESHOLD = 240;

function isNodeErrored(output: string | null | undefined): boolean {
  if (!output) return false;
  // engine/nodes.py error sentinel: "Error in {label}: ..."
  return /^Error in /.test(output) || /\[ERROR\]/.test(output);
}

const roleBarColors: Record<string, string> = {
  searcher: "bg-emerald-500/70 border-emerald-400",
  summarizer: "bg-cyan-500/70 border-cyan-400",
  writer: "bg-amber-500/70 border-amber-400",
  coder: "bg-indigo-500/70 border-indigo-400",
  formatter: "bg-pink-500/70 border-pink-400",
  default: "bg-primary/70 border-primary",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const roleIcons: Record<string, any> = {
  searcher: Search,
  summarizer: BrainCircuit,
  writer: PenLine,
  coder: Code,
  formatter: Database,
  default: Cpu,
  architect: BrainCircuit,
};

export default function LogsPage() {
  const t = useT();
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  const toggleNodeExpanded = (nodeId: string) => {
    setExpandedNodes((prev) => ({ ...prev, [nodeId]: !prev[nodeId] }));
  };

  useEffect(() => {
    if (activeWorkspaceId) {
      loadLogs(activeWorkspaceId);
    } else {
      setLoading(false);
      setLogs([]);
    }
  }, [activeWorkspaceId]);

  const loadLogs = async (wsId: number) => {
    setLoading(true);
    try {
      const data = await api.getExecutionLogs(wsId);
      setLogs(data);
      if (data.length > 0) {
        setSelectedLogId(data[0].id);
      }
    } catch (error) {
      console.error("Failed to load logs:", error);
    } finally {
      setLoading(false);
    }
  };

  const selectedLog = logs.find((l) => l.id === selectedLogId);

  if (!activeWorkspaceId) {
    return (
      <div className="flex h-full items-center justify-center text-white/55">
        {t('no_workspace_hint')}
      </div>
    );
  }

  return (
    <div className="flex h-full gap-4 overflow-hidden">
      {/* 侧边栏：任务列表 */}
      <div className="w-1/3 min-w-[280px] max-w-[320px] border border-primary/20 rounded-lg bg-muted/40 flex flex-col overflow-hidden shadow-[0_0_20px_rgba(153,51,255,0.1)]">
        <div className="p-4 border-b border-primary/20 bg-primary/5 flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="font-mono font-bold tracking-widest text-primary">{t('radar_net_title')}</h2>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {loading ? (
            <div className="p-8 text-center text-white/55 animate-pulse">{t('syncing_satellite')}</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-white/35">{t('no_records')}</div>
          ) : (
            <div className="p-2 space-y-2">
              {logs.map((log) => (
                <button
                  key={log.id}
                  onClick={() => setSelectedLogId(log.id)}
                  className={`w-full text-left p-3 rounded-md transition-all flex flex-col gap-2 border ${
                    selectedLogId === log.id
                      ? "bg-primary/20 border-primary shadow-[0_0_10px_rgba(153,51,255,0.3)]"
                      : "bg-muted/20 border-primary/10 hover:border-primary/50 hover:bg-primary/10"
                  }`}
                >
                  <div className="flex justify-between items-center w-full">
                    <span className="font-mono text-sm text-primary flex items-center gap-2">
                      {log.status === "completed" ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : log.status === "failed" ? (
                        <ServerCrash className="h-4 w-4 text-red-500" />
                      ) : (
                        <Activity className="h-4 w-4 text-blue-500 animate-pulse" />
                      )}
                      {t('task_label', { id: String(log.id) })}
                    </span>
                    <span className="text-xs text-white/55">
                      {new Date(log.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {log.nodes_snapshot && (
                      <span className="text-[10px] font-mono text-primary/60 bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                        {t('node_count_badge', { n: String(log.nodes_snapshot.length) })}
                      </span>
                    )}
                    {log.execution_time_ms && (
                      <span className="text-[10px] font-mono text-primary/60 flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {(log.execution_time_ms / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-primary/70 line-clamp-1">
                    {log.initial_payload || t('no_initial_instruction')}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 主面板：日志详情 */}
      <div className="flex-1 border border-primary/20 rounded-lg bg-muted/40 flex flex-col overflow-hidden shadow-[0_0_20px_rgba(153,51,255,0.1)]">
        <div className="p-4 border-b border-primary/20 bg-primary/5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-mono font-bold tracking-widest">
            <Terminal className="h-5 w-5" />
            <span>{t('trace_panel_title')}</span>
          </div>
          {selectedLog && (
            <div className="flex items-center gap-3">
              <span className={`text-xs font-mono px-2 py-1 rounded border ${
                selectedLog.status === "completed"
                  ? "text-green-400 border-green-500/30 bg-green-500/10"
                  : selectedLog.status === "failed"
                  ? "text-red-400 border-red-500/30 bg-red-500/10"
                  : "text-blue-400 border-blue-500/30 bg-blue-500/10 animate-pulse"
              }`}>
                {selectedLog.status === "completed" ? t('status_completed') : selectedLog.status === "failed" ? t('status_failed') : t('status_running')}
              </span>
              <div className="flex items-center gap-2 text-xs text-primary/70 bg-muted/40 px-3 py-1 rounded border border-primary/20">
                <Clock className="h-3 w-3" />
                {t('duration_label', { time: selectedLog.execution_time_ms ? `${(selectedLog.execution_time_ms / 1000).toFixed(2)}s` : t('duration_unknown') })}
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {selectedLog ? (
            <div className="space-y-6">
              {/* 初始输入 */}
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-primary/80 flex items-center gap-2">
                  <ChevronRight className="h-4 w-4" /> {t('section_deploy_input')}
                </h3>
                <div className="bg-muted/60 p-4 rounded-md border border-primary/20 font-mono text-sm text-primary/90 whitespace-pre-wrap">
                  {selectedLog.initial_payload || "N/A"}
                </div>
              </div>

              {/* 执行时序图 (Gantt) */}
              {selectedLog.node_timings && selectedLog.nodes_snapshot && Object.keys(selectedLog.node_timings).length > 0 && (() => {
                const timings = selectedLog.node_timings as Record<string, { started_at: number; ended_at: number; duration_ms: number }>;
                const allStarts = Object.values(timings).map(t => t.started_at);
                const allEnds = Object.values(timings).map(t => t.ended_at);
                const t0 = Math.min(...allStarts);
                const tEnd = Math.max(...allEnds);
                const totalSpan = Math.max(tEnd - t0, 1);

                return (
                  <div className="space-y-2">
                    <h3 className="text-sm font-bold text-primary/80 flex items-center gap-2">
                      <ChevronRight className="h-4 w-4" /> {t('section_timeline')}
                    </h3>
                    <div className="bg-muted/60 p-4 rounded-md border border-primary/20 space-y-1.5">
                      {selectedLog.nodes_snapshot.map((node: any) => {
                        const timing = timings[node.id];
                        const errored = isNodeErrored(selectedLog.results_by_node?.[node.id]);
                        const colorCls = errored
                          ? "bg-red-500/70 border-red-400"
                          : (roleBarColors[node.role] || roleBarColors.default);

                        if (!timing) {
                          return (
                            <div key={node.id} className="flex items-center gap-3 text-xs font-mono">
                              <div className="w-28 truncate text-white/40 shrink-0">{node.label}</div>
                              <div className="flex-1 h-5 bg-background/40 rounded border border-primary/10" />
                              <div className="w-16 text-right text-white/30 shrink-0">—</div>
                            </div>
                          );
                        }

                        const leftPct = ((timing.started_at - t0) / totalSpan) * 100;
                        const widthPct = Math.max((timing.duration_ms / totalSpan) * 100, 0.5);

                        return (
                          <div key={node.id} className="flex items-center gap-3 text-xs font-mono">
                            <div className={`w-28 truncate shrink-0 ${errored ? "text-red-300" : "text-white/80"}`}>{node.label}</div>
                            <div className="flex-1 h-5 relative bg-background/40 rounded border border-primary/10 overflow-hidden">
                              <div
                                className={`absolute top-0 bottom-0 ${colorCls} border-l border-r shadow-[0_0_8px_rgba(153,51,255,0.3)]`}
                                style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: '2px' }}
                                title={`${formatDuration(timing.duration_ms)}`}
                              />
                            </div>
                            <div className={`w-16 text-right shrink-0 ${errored ? "text-red-300" : "text-primary/80"}`}>
                              {formatDuration(timing.duration_ms)}
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex items-center gap-3 text-[10px] font-mono pt-2 border-t border-primary/10 mt-2">
                        <div className="w-28 shrink-0 text-white/40 uppercase">{t('timeline_total')}</div>
                        <div className="flex-1 text-white/40">0ms → {formatDuration(totalSpan)}</div>
                        <div className="w-16 text-right text-primary/80 font-bold shrink-0">{formatDuration(totalSpan)}</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 逐节点产物链路 */}
              {selectedLog.nodes_snapshot && selectedLog.nodes_snapshot.length > 0 && selectedLog.results_by_node && (
                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-primary/80 flex items-center gap-2">
                    <ChevronRight className="h-4 w-4" /> {t('section_node_trace')}
                  </h3>
                  <div className="space-y-2">
                    {selectedLog.nodes_snapshot.map((node: any, idx: number) => {
                      const Icon = roleIcons[node.role] || roleIcons.default;
                      const nodeOutput = selectedLog.results_by_node[node.id];
                      const hasOutput = nodeOutput !== undefined && nodeOutput !== null;
                      const errored = hasOutput && isNodeErrored(nodeOutput);
                      const isLongOutput = hasOutput && String(nodeOutput).length > NODE_OUTPUT_COLLAPSE_THRESHOLD;
                      const isExpanded = expandedNodes[node.id] ?? !isLongOutput;
                      const displayOutput = hasOutput && isLongOutput && !isExpanded
                        ? String(nodeOutput).slice(0, NODE_OUTPUT_COLLAPSE_THRESHOLD) + "…"
                        : nodeOutput;

                      let containerCls = "border-primary/10 bg-muted/20 opacity-50";
                      if (hasOutput && errored) {
                        containerCls = "border-red-500/50 bg-red-500/5 shadow-[0_0_15px_rgba(239,68,68,0.15)]";
                      } else if (hasOutput) {
                        containerCls = "border-primary/40 bg-primary/5";
                      }

                      return (
                        <div key={node.id}>
                          <div className={`rounded-lg border p-4 space-y-3 ${containerCls}`}>
                            {/* 节点头部 */}
                            <div className="flex items-center gap-3">
                              <div className={`flex h-8 w-8 items-center justify-center rounded shrink-0 ${
                                errored
                                  ? "bg-red-500/20 border border-red-500/50"
                                  : "bg-primary/20 border border-primary/40"
                              }`}>
                                <Icon className={`h-4 w-4 ${errored ? "text-red-400" : "text-primary"}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`font-mono font-bold text-sm truncate ${errored ? "text-red-300" : "text-white"}`}>{node.label}</span>
                                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 uppercase ${
                                    errored
                                      ? "text-red-400 bg-red-500/10 border-red-500/30"
                                      : "text-primary/60 bg-primary/10 border-primary/20"
                                  }`}>
                                    {node.role}
                                  </span>
                                </div>
                                <span className="text-[10px] text-white/45 font-mono">{node.id}</span>
                              </div>
                              {hasOutput && errored ? (
                                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                              ) : hasOutput ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                              ) : (
                                <div className="h-4 w-4 rounded-full border border-primary/30 shrink-0" />
                              )}
                            </div>

                            {/* 节点输出 */}
                            {hasOutput && (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className={`text-[10px] font-mono uppercase ${errored ? "text-red-400/80" : "text-white/55"}`}>
                                    {errored ? t('output_error') : t('output_artifact')}
                                  </span>
                                  {isLongOutput && (
                                    <button
                                      onClick={() => toggleNodeExpanded(node.id)}
                                      className={`text-[10px] font-mono flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${
                                        errored
                                          ? "text-red-400/80 border-red-500/30 hover:bg-red-500/10"
                                          : "text-primary/70 border-primary/30 hover:bg-primary/10"
                                      }`}
                                    >
                                      {isExpanded ? (
                                        <>
                                          <ChevronDown className="h-3 w-3 rotate-180" />
                                          {t('toggle_collapse')}
                                        </>
                                      ) : (
                                        <>
                                          <ChevronDown className="h-3 w-3" />
                                          {t('toggle_expand')}
                                        </>
                                      )}
                                    </button>
                                  )}
                                </div>
                                <div className={`bg-background/95 p-3 rounded border font-mono text-xs whitespace-pre-wrap overflow-y-auto ${
                                  isExpanded ? "max-h-96" : "max-h-32"
                                } ${errored ? "border-red-500/20 text-red-200/90" : "border-primary/10 text-white/80"}`}>
                                  {displayOutput}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* 节点间箭头 */}
                          {idx < selectedLog.nodes_snapshot.length - 1 && (
                            <div className="flex justify-center py-1">
                              <ArrowDown className="h-4 w-4 text-white/45" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 运行日志 */}
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-primary/80 flex items-center gap-2">
                  <ChevronRight className="h-4 w-4" /> {t('section_system_logs')}
                </h3>
                <div className="bg-muted/60 p-4 rounded-md border border-primary/20 font-mono text-sm text-green-400/90 whitespace-pre-wrap">
                  {selectedLog.logs_json?.length ? (
                    selectedLog.logs_json.map((line: string, i: number) => (
                      <div key={i} className="mb-1">{"> "}{line}</div>
                    ))
                  ) : (
                    t('no_system_logs')
                  )}
                </div>
              </div>

              {/* 最终输出 */}
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-primary/80 flex items-center gap-2">
                  <ChevronRight className="h-4 w-4" /> {t('section_final_output')}
                </h3>
                <div className="bg-muted/60 p-4 rounded-md border border-primary/20 font-mono text-sm text-primary whitespace-pre-wrap shadow-[inset_0_0_20px_rgba(153,51,255,0.05)]">
                  {selectedLog.final_payload || t('no_final_output')}
                </div>
              </div>

            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-white/35 font-mono text-sm">
              {t('select_radar_target')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
