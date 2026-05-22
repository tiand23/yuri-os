"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/api";
import { Activity, Clock, ServerCrash, CheckCircle2, ChevronRight, Terminal, ArrowDown, Cpu, Code, Search, Database, BrainCircuit, PenLine } from "lucide-react";
import { useT } from "@/lib/useT";

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

                      return (
                        <div key={node.id}>
                          <div className={`rounded-lg border p-4 space-y-3 ${
                            hasOutput
                              ? "border-primary/40 bg-primary/5"
                              : "border-primary/10 bg-muted/20 opacity-50"
                          }`}>
                            {/* 节点头部 */}
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/20 border border-primary/40 shrink-0">
                                <Icon className="h-4 w-4 text-primary" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-sm text-white truncate">{node.label}</span>
                                  <span className="text-[10px] font-mono text-primary/60 bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20 shrink-0 uppercase">
                                    {node.role}
                                  </span>
                                </div>
                                <span className="text-[10px] text-white/45 font-mono">{node.id}</span>
                              </div>
                              {hasOutput ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                              ) : (
                                <div className="h-4 w-4 rounded-full border border-primary/30 shrink-0" />
                              )}
                            </div>

                            {/* 节点输出 */}
                            {hasOutput && (
                              <div className="space-y-1">
                                <span className="text-[10px] font-mono text-white/55 uppercase">{t('output_artifact')}</span>
                                <div className="bg-background/95 p-3 rounded border border-primary/10 font-mono text-xs text-white/80 whitespace-pre-wrap max-h-48 overflow-y-auto">
                                  {nodeOutput}
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
