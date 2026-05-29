"use client";

import { X, Trash2, Terminal, GitBranch, Cpu, Save, Wrench, Code2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/useT";
import { api, ToolMetadata } from "@/lib/api";

interface AgentConfigPanelProps {
  nodeId: string | null;
  nodeData: any;
  onClose: () => void;
  onUpdate: (id: string, newData: any) => void;
  onDelete: (id: string) => void;
}

// Module-level cache so we only hit /api/tools once per page lifetime
let toolsCache: ToolMetadata[] | null = null;

export function AgentConfigPanel({ nodeId, nodeData, onClose, onUpdate, onDelete }: AgentConfigPanelProps) {
  const [formData, setFormData] = useState<any>({});
  const [dirty, setDirty] = useState(false);
  const [availableTools, setAvailableTools] = useState<ToolMetadata[]>(toolsCache ?? []);
  const t = useT();

  useEffect(() => {
    if (nodeData) {
      setFormData(nodeData);
      setDirty(false);
    }
  }, [nodeId, nodeData]);

  useEffect(() => {
    if (toolsCache) return;
    api.listTools().then(({ tools }) => {
      toolsCache = tools;
      setAvailableTools(tools);
    }).catch(() => {/* tool list unavailable — fall back to no checkboxes */});
  }, []);

  // Treat undefined tools as "all enabled" (legacy behavior matching backend select_tools(None))
  const selectedTools: string[] = Array.isArray(formData.tools)
    ? formData.tools
    : availableTools.map(t => t.name);

  const toggleTool = (name: string) => {
    const next = selectedTools.includes(name)
      ? selectedTools.filter(n => n !== name)
      : [...selectedTools, name];
    const newData = { ...formData, tools: next };
    setFormData(newData);
    setDirty(true);
  };

  if (!nodeId || !nodeData) return null;

  const isCondition = nodeData.condition_prompt !== undefined || nodeData.role === "condition";
  const isCode = nodeData.role === "code" || nodeData.code !== undefined;

  const handleChange = (field: string, value: string) => {
    const newData = { ...formData, [field]: value };
    setFormData(newData);
    setDirty(true);
  };

  const handleApply = () => {
    onUpdate(nodeId, formData);
    setDirty(false);
  };

  return (
    <div className="absolute top-4 right-4 z-10 w-80 rounded-lg border border-primary/40 bg-card/90 shadow-[0_0_30px_rgba(153,51,255,0.15)] backdrop-blur-xl animate-in slide-in-from-right-4 duration-200 flex flex-col max-h-[calc(100vh-6rem)]">
      {/* 标题 */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-primary/20 shrink-0">
        <h3 className="font-mono text-sm font-bold text-primary tracking-widest flex items-center gap-2">
          {isCondition
            ? <><GitBranch className="h-4 w-4 text-yellow-400" /><span className="text-yellow-400">{t('panel_title_condition')}</span></>
            : isCode
              ? <><Code2 className="h-4 w-4 text-emerald-400" /><span className="text-emerald-400">{t('panel_title_code')}</span></>
              : <><Cpu className="h-4 w-4" />{t('panel_title_agent')}</>
          }
        </h3>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-[10px] font-mono text-yellow-400 animate-pulse">{t('unsaved_indicator')}</span>
          )}
          <button onClick={onClose} className="text-white/55 hover:text-primary transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 表单 */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
        {isCondition ? (
          /* 条件节点字段 */
          <>
            <div className="space-y-1.5">
              <label className="font-mono text-xs font-bold tracking-wider text-yellow-400/80 uppercase">{t('field_node_name')}</label>
              <input
                value={formData.label || ""}
                onChange={e => handleChange("label", e.target.value)}
                className="w-full rounded border border-yellow-500/30 bg-background p-2.5 font-mono text-sm text-white focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400/30"
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-mono text-xs font-bold tracking-wider text-yellow-400/80 uppercase flex items-center gap-1">
                <Terminal className="h-3 w-3" /> {t('field_condition_prompt_label')}
              </label>
              <p className="text-[10px] font-mono text-slate-500">{t('condition_prompt_hint')}</p>
              <textarea
                value={formData.condition_prompt || ""}
                onChange={e => handleChange("condition_prompt", e.target.value)}
                rows={6}
                placeholder={t('condition_prompt_placeholder')}
                className="w-full rounded border border-yellow-500/30 bg-background/95 p-2.5 font-mono text-xs text-yellow-200/80 placeholder:text-white/30 focus:border-yellow-400 focus:outline-none resize-none leading-relaxed"
              />
            </div>
          </>
        ) : isCode ? (
          /* Code 节点字段 — 沙箱 Python，stdin 拿 payload，stdout 是输出 */
          <>
            <div className="space-y-1.5">
              <label className="font-mono text-xs font-bold tracking-wider text-emerald-400/80 uppercase">{t('field_node_name')}</label>
              <input
                value={formData.label || ""}
                onChange={e => handleChange("label", e.target.value)}
                className="w-full rounded border border-emerald-500/30 bg-background p-2.5 font-mono text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30"
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-mono text-xs font-bold tracking-wider text-emerald-400/80 uppercase">{t('field_core_directive')}</label>
              <textarea
                value={formData.description || ""}
                onChange={e => handleChange("description", e.target.value)}
                rows={2}
                className="w-full rounded border border-emerald-500/30 bg-background p-2.5 font-mono text-sm text-white focus:border-emerald-400 focus:outline-none resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-mono text-xs font-bold tracking-wider text-emerald-400/80 uppercase flex items-center gap-1">
                <Code2 className="h-3 w-3" /> {t('field_code_label')}
              </label>
              <p className="text-[10px] font-mono text-slate-500 leading-relaxed">{t('code_hint')}</p>
              <textarea
                value={formData.code || ""}
                onChange={e => handleChange("code", e.target.value)}
                rows={14}
                spellCheck={false}
                placeholder={"import sys\npayload = sys.stdin.read()\n# transform payload here\nprint(payload)"}
                className="w-full rounded border border-emerald-500/30 bg-black/60 p-2.5 font-mono text-xs text-emerald-200/90 placeholder:text-white/30 focus:border-emerald-400 focus:outline-none resize-y leading-relaxed"
              />
            </div>
          </>
        ) : (
          /* Agent 节点字段 */
          <>
            <div className="space-y-1.5">
              <label className="font-mono text-xs font-bold tracking-wider text-primary/80 uppercase">{t('field_facility_code')}</label>
              <input
                value={formData.label || ""}
                onChange={e => handleChange("label", e.target.value)}
                className="w-full rounded border border-primary/40 bg-background p-2.5 font-mono text-sm text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-mono text-xs font-bold tracking-wider text-white/55 uppercase">{t('field_role_type')}</label>
              <input
                disabled
                value={formData.role || ""}
                className="w-full rounded border border-primary/20 bg-background/50 p-2.5 font-mono text-sm text-white/45 cursor-not-allowed uppercase"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-mono text-xs font-bold tracking-wider text-violet-400/80 uppercase">{t('field_input')}</label>
              <input
                value={formData.input || ""}
                onChange={e => handleChange("input", e.target.value)}
                className="w-full rounded border border-violet-500/30 bg-background p-2.5 font-mono text-sm text-white focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400/30"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-mono text-xs font-bold tracking-wider text-primary/80 uppercase">{t('field_core_directive')}</label>
              <textarea
                value={formData.description || ""}
                onChange={e => handleChange("description", e.target.value)}
                rows={3}
                className="w-full rounded border border-primary/40 bg-background p-2.5 font-mono text-sm text-white focus:border-primary focus:outline-none resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-mono text-xs font-bold tracking-wider text-emerald-400/80 uppercase">{t('field_output')}</label>
              <input
                value={formData.output || ""}
                onChange={e => handleChange("output", e.target.value)}
                className="w-full rounded border border-emerald-500/30 bg-background p-2.5 font-mono text-sm text-white focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/30"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-mono text-xs font-bold tracking-wider text-green-400/70 uppercase flex items-center gap-1">
                <Terminal className="h-3 w-3" /> {t('system_prompt_label')}
              </label>
              <textarea
                value={formData.system_prompt || ""}
                onChange={e => handleChange("system_prompt", e.target.value)}
                rows={5}
                placeholder={t('placeholder_system_prompt')}
                className="w-full rounded border border-green-500/20 bg-background/95 p-2.5 font-mono text-xs text-green-400/80 placeholder:text-white/30 focus:border-green-500/50 focus:outline-none resize-none leading-relaxed"
              />
            </div>

            {/* 工具装备区 — 节点级 tool 选择，对应 backend engine/tools.py 的 TOOL_REGISTRY */}
            {availableTools.length > 0 && (
              <div className="space-y-2">
                <label className="font-mono text-xs font-bold tracking-wider text-cyan-400/80 uppercase flex items-center gap-1">
                  <Wrench className="h-3 w-3" /> {t('tools_label')}
                </label>
                <p className="text-[10px] font-mono text-slate-500 leading-relaxed">{t('tools_hint')}</p>
                <div className="space-y-1.5">
                  {availableTools.map(tool => {
                    const enabled = selectedTools.includes(tool.name);
                    const recommended = tool.recommended_for.includes(formData.role || "");
                    return (
                      <div
                        key={tool.name}
                        onClick={() => toggleTool(tool.name)}
                        className={`flex items-start gap-2 p-2 rounded border cursor-pointer transition-all ${
                          enabled
                            ? "border-cyan-500/50 bg-cyan-500/10"
                            : "border-white/10 bg-background/40 hover:border-cyan-500/30"
                        }`}
                      >
                        <div className={`w-3.5 h-3.5 mt-0.5 rounded border flex items-center justify-center shrink-0 transition-all ${
                          enabled
                            ? "border-cyan-400 bg-cyan-400/20"
                            : "border-white/30 bg-transparent"
                        }`}>
                          {enabled && <div className="w-1.5 h-1.5 bg-cyan-300 rounded-sm" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`font-mono text-xs font-bold ${enabled ? "text-cyan-200" : "text-white/60"}`}>
                              {tool.label}
                            </span>
                            {recommended && (
                              <span className="text-[9px] font-mono px-1 py-0 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 uppercase">
                                {t('tool_recommended')}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] font-mono text-white/45 mt-0.5">{tool.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 底部操作 */}
      <div className="px-5 py-4 border-t border-primary/20 shrink-0 flex gap-2">
        <button
          onClick={handleApply}
          disabled={!dirty}
          className="flex-1 flex items-center justify-center gap-2 py-2 bg-primary/20 text-primary font-mono text-xs font-bold border border-primary/50 hover:bg-primary hover:text-black transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Save className="h-3.5 w-3.5" />
          {t('btn_apply_changes')}
        </button>
        <button
          onClick={() => onDelete(nodeId)}
          className="px-3 py-2 bg-red-500/10 text-red-400/70 font-mono text-xs font-bold border border-red-500/20 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/40 transition-all"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
