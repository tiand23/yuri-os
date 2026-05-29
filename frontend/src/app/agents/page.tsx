"use client";

import { useState, useRef } from "react";
import { useAppStore } from "@/lib/store";
import { useLLMStore } from "@/lib/llm-store";
import { api } from "@/lib/api";
import { useT } from "@/lib/useT";
import { useI18nStore } from "@/lib/i18n-store";
import {
  BrainCircuit, Code, Database, Search, Cpu, Plus, X,
  ArrowDown, Terminal, Sparkles, CheckCircle2, Trash2,
  Pencil, Save, ChevronRight, FileArchive, Play, Clock, Upload, AlertTriangle,
} from "lucide-react";

const roleIcons: Record<string, any> = {
  searcher: Search,
  summarizer: BrainCircuit,
  coder: Code,
  formatter: Database,
  default: Cpu,
  architect: BrainCircuit,
};

const roleColors: Record<string, string> = {
  searcher:   "text-blue-300 border-blue-500/50 bg-blue-500/15",
  summarizer: "text-purple-300 border-purple-500/50 bg-purple-500/15",
  coder:      "text-yellow-300 border-yellow-500/50 bg-yellow-500/15",
  formatter:  "text-emerald-300 border-emerald-500/50 bg-emerald-500/15",
  default:    "text-violet-300 border-violet-500/50 bg-violet-500/15",
  architect:  "text-violet-300 border-violet-500/50 bg-violet-500/15",
};

// 左侧彩条颜色
const roleStripe: Record<string, string> = {
  searcher:   "bg-blue-500",
  summarizer: "bg-purple-500",
  coder:      "bg-yellow-500",
  formatter:  "bg-emerald-500",
  default:    "bg-violet-500",
  architect:  "bg-violet-500",
};

// 图标背景
const roleIconBg: Record<string, string> = {
  searcher:   "bg-blue-500/20 border-blue-500/40",
  summarizer: "bg-purple-500/20 border-purple-500/40",
  coder:      "bg-yellow-500/20 border-yellow-500/40",
  formatter:  "bg-emerald-500/20 border-emerald-500/40",
  default:    "bg-violet-500/20 border-violet-500/40",
  architect:  "bg-violet-500/20 border-violet-500/40",
};

const ROLES = ["default", "searcher", "summarizer", "coder", "formatter"];

export default function BattleLabPage() {
  const { globalAgents, addAgent, activeWorkspaceId, setAgents } = useAppStore();
  const { profiles: llmProfiles } = useLLMStore();
  const t = useT();
  const locale = useI18nStore((s) => s.locale);

  // AI 生成面板
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAgent, setGeneratedAgent] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // 详情/编辑抽屉
  const [selectedAgent, setSelectedAgent] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // 单体测试
  const [testInput, setTestInput] = useState("");
  const [testResult, setTestResult] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [fileHint, setFileHint] = useState("");
  const [fileHintIsError, setFileHintIsError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    const sizeKB = (file.size / 1024).toFixed(1);
    e.target.value = "";

    setFileHint(t('file_reading'));

    try {
      // PDF
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
        const text = pages.join("\n\n");
        setTestInput(text);
        setFileHint(t('file_parsed_pdf', { name: file.name, size: sizeKB, pages: pdf.numPages }));
        setFileHintIsError(false);
        return;
      }

      // DOCX
      if (ext === ".docx") {
        const arrayBuffer = await file.arrayBuffer();
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ arrayBuffer });
        setTestInput(result.value);
        setFileHint(t('file_parsed_word', { name: file.name, size: sizeKB }));
        setFileHintIsError(false);
        return;
      }

      // 不支持的二进制格式
      if ([".doc", ".pptx", ".xlsx", ".xls"].includes(ext)) {
        setFileHint(t('file_unsupported_ext', { ext }));
        setFileHintIsError(true);
        return;
      }

      // 其余文本格式
      const reader = new FileReader();
      reader.onload = (ev) => {
        setTestInput(ev.target?.result as string);
        setFileHint(t('file_read_ok', { name: file.name, size: sizeKB }));
        setFileHintIsError(false);
      };
      reader.readAsText(file, "utf-8");

    } catch (err) {
      setFileHint(`${t('file_parse_failed')}: ${String(err)}`);
      setFileHintIsError(true);
    }
  };

  // 手动创建 Modal
  const [showManualModal, setShowManualModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({ label: "", role: "default", description: "", input: "", output: "" });

  /* ── AI 生成 ── */
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setGeneratedAgent(null);
    setGenerationError(null);
    try {
      const result = await api.generateAgent(aiPrompt, locale);
      setGeneratedAgent(result);
    } catch (err) {
      console.error("Generation failed", err);
      setGenerationError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveGenerated = async () => {
    if (!generatedAgent || !activeWorkspaceId) return;
    setIsSaving(true);
    setGenerationError(null);
    try {
      const newAgent = await api.createAgent(activeWorkspaceId, {
        role: generatedAgent.role,
        label: generatedAgent.label,
        description: generatedAgent.description,
        input: generatedAgent.input,
        output: generatedAgent.output,
        config_json: { system_prompt: generatedAgent.system_prompt },
      });
      addAgent({ id: newAgent.id.toString(), role: newAgent.role, label: newAgent.label, description: newAgent.description || "", input: newAgent.input || "", output: newAgent.output || "" });
      setGeneratedAgent(null);
      setAiPrompt("");
    } catch (err) {
      console.error("Save failed", err);
      setGenerationError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  /* ── 选中查看详情 ── */
  const handleSelectAgent = (agent: any) => {
    setSelectedAgent(agent);
    setIsEditing(false);
    setEditForm({ label: agent.label, role: agent.role, description: agent.description, input: agent.input, output: agent.output, system_prompt: agent.system_prompt || "", model: agent.config_json?.model || "", temperature: agent.config_json?.temperature ?? 0.1 });
    setTestInput("");
    setTestResult(null);
    setFileHint("");
  };

  const handleStartEdit = () => setIsEditing(true);
  const handleCancelEdit = () => { setIsEditing(false); setEditForm({ label: selectedAgent.label, role: selectedAgent.role, description: selectedAgent.description, input: selectedAgent.input, output: selectedAgent.output }); };

  const handleSaveEdit = async () => {
    if (!selectedAgent || selectedAgent.id.startsWith("default_")) return;
    setIsSavingEdit(true);
    try {
      const { model, temperature, system_prompt, ...baseFields } = editForm;
      const payload = {
        ...baseFields,
        config_json: {
          ...(selectedAgent.config_json || {}),
          system_prompt,
          model,
          temperature: parseFloat(temperature),
        },
      };
      await api.updateAgent(parseInt(selectedAgent.id), payload);
      const updatedAgent = { ...selectedAgent, ...baseFields, system_prompt, config_json: payload.config_json };
      setAgents(globalAgents.map(a => a.id === selectedAgent.id ? { ...a, ...baseFields, system_prompt } : a));
      setSelectedAgent(updatedAgent);
      setIsEditing(false);
    } catch (err) {
      console.error("Update failed", err);
    } finally {
      setIsSavingEdit(false);
    }
  };

  /* ── 删除 ── */
  const handleDelete = async (id: string) => {
    if (id.startsWith("default_")) return;
    if (!confirm(t('confirm_destroy_archive'))) return;
    try {
      await api.deleteAgent(parseInt(id));
      setAgents(globalAgents.filter(a => a.id !== id));
      if (selectedAgent?.id === id) setSelectedAgent(null);
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  /* ── 单体测试 ── */
  const handleTest = async () => {
    if (!selectedAgent || !testInput.trim()) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await api.testAgent({
        label: selectedAgent.label,
        description: selectedAgent.description,
        system_prompt: selectedAgent.system_prompt || "",
        model: selectedAgent.config_json?.model || "",
        temperature: selectedAgent.config_json?.temperature ?? 0.1,
        input_text: testInput,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ error: t('test_error_msg') });
    } finally {
      setIsTesting(false);
    }
  };

  /* ── 手动构筑 ── */
  const handleManualCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.label || !activeWorkspaceId) return;
    setIsSubmitting(true);
    try {
      const newAgent = await api.createAgent(activeWorkspaceId, { ...formData, description: formData.description || t('default_facility_desc'), input: formData.input || t('default_input_any'), output: formData.output || t('default_output_std') });
      addAgent({ id: newAgent.id.toString(), role: newAgent.role, label: newAgent.label, description: newAgent.description || "", input: newAgent.input || "", output: newAgent.output || "" });
      setShowManualModal(false);
      setFormData({ label: "", role: "default", description: "", input: "", output: "" });
    } catch (err) {
      console.error("Create failed", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDefaultAgent = selectedAgent?.id?.startsWith("default_");

  return (
    <div className="flex h-full gap-4 overflow-hidden">

      {/* ── 左栏：AI 研发终端 ── */}
      <div className="w-[380px] shrink-0 flex flex-col border border-primary/30 rounded-lg bg-muted/60 shadow-[0_0_20px_rgba(153,51,255,0.1)] overflow-hidden">
        <div className="p-4 border-b border-primary/20 bg-primary/5 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary animate-pulse" />
          <h2 className="font-mono font-bold tracking-widest text-primary">{t('ai_lab_title')}</h2>
        </div>

        <form onSubmit={handleGenerate} className="p-4 border-b border-primary/10 space-y-3">
          <p className="text-xs font-mono text-white/45 uppercase tracking-wider">{t('ai_lab_prompt_hint')}</p>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder={t('placeholder_agent_generate_example')}
            rows={5}
            className="w-full rounded border border-primary/30 bg-background/95 p-3 font-mono text-sm text-white focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
          <button
            type="submit"
            disabled={isGenerating || !aiPrompt.trim()}
            className="w-full py-2.5 bg-primary/20 text-white font-mono font-bold border border-primary hover:bg-primary hover:text-black hover:shadow-[0_0_20px_rgba(153,51,255,0.8)] transition-all tracking-widest disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {isGenerating ? t('btn_generating') : t('btn_generate')}
          </button>
        </form>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {generationError && !isGenerating && (
            <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 flex items-start gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-mono font-bold text-red-300 uppercase tracking-wider mb-0.5">
                  {t('lab_generation_error')}
                </div>
                <div className="text-xs font-mono text-red-200/90 break-words">{generationError}</div>
              </div>
              <button onClick={() => setGenerationError(null)} className="text-red-400/60 hover:text-red-400 shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {isGenerating && (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-white/55">
              <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <span className="font-mono text-sm animate-pulse">{t('generating_thinking')}</span>
            </div>
          )}

          {generatedAgent && !isGenerating && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-white/55 uppercase tracking-wider">{t('generated_preview_label')}</span>
                <button onClick={() => setGeneratedAgent(null)} className="text-white/35 hover:text-primary"><X className="h-4 w-4" /></button>
              </div>

              <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  {(() => { const Icon = roleIcons[generatedAgent.role] || roleIcons.default; return <Icon className="h-5 w-5 text-primary" />; })()}
                  <span className="font-mono font-bold text-white text-base flex-1">{generatedAgent.label}</span>
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border uppercase ${roleColors[generatedAgent.role] || roleColors.default}`}>
                    {generatedAgent.role}
                  </span>
                </div>

                <p className="text-xs text-slate-300 font-mono leading-relaxed">{generatedAgent.description}</p>

                <div className="space-y-2 p-3 bg-muted/40 rounded border border-white/10">
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] font-bold text-violet-300 bg-violet-500/20 px-1.5 py-0.5 rounded shrink-0">IN</span>
                    <span className="text-xs text-slate-300 font-mono leading-snug">{generatedAgent.input}</span>
                  </div>
                  <div className="flex justify-center"><ArrowDown className="h-3 w-3 text-white/20" /></div>
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] font-bold text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded shrink-0">OUT</span>
                    <span className="text-xs text-slate-300 font-mono leading-snug">{generatedAgent.output}</span>
                  </div>
                </div>

                <button onClick={() => setShowSystemPrompt(!showSystemPrompt)} className="w-full text-left text-xs font-mono text-white/45 hover:text-primary flex items-center gap-1 transition-colors">
                  <Terminal className="h-3 w-3" />
                  {showSystemPrompt ? t('toggle_collapse') : t('toggle_expand')} System Prompt
                </button>
                {showSystemPrompt && (
                  <div className="bg-background/95 p-3 rounded border border-primary/10 font-mono text-xs text-green-400/70 whitespace-pre-wrap leading-relaxed">
                    {generatedAgent.system_prompt}
                  </div>
                )}
              </div>

              <button
                onClick={handleSaveGenerated}
                disabled={isSaving || !activeWorkspaceId}
                className="w-full py-3 bg-green-500/20 text-green-400 font-mono font-bold border border-green-500/50 hover:bg-green-500 hover:text-black hover:shadow-[0_0_20px_rgba(0,255,100,0.5)] transition-all tracking-widest disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4" />
                {!activeWorkspaceId ? t('select_workspace_first') : isSaving ? t('archiving') : t('confirm_archive')}
              </button>
            </div>
          )}

          {!isGenerating && !generatedAgent && (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-white/25">
              <Sparkles className="h-8 w-8" />
              <span className="font-mono text-sm">{t('waiting_instruction')}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── 中栏：特种设施档案局 ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="flex items-center justify-between mb-4 border-b border-primary/20 pb-4 shrink-0">
          <div>
            <h1 className="text-xl font-bold tracking-widest text-primary drop-shadow-[0_0_8px_rgba(153,51,255,0.8)] flex items-center gap-2">
              <FileArchive className="h-6 w-6" />
              {t('archive_bureau_title')}
            </h1>
            <p className="text-white/40 mt-0.5 font-mono text-[11px] tracking-wider uppercase">
              SPECIAL FACILITY ARCHIVES — {globalAgents.length} units on record
            </p>
          </div>
          <button
            onClick={() => setShowManualModal(true)}
            className="flex items-center px-4 py-2 bg-primary/10 text-primary font-mono text-sm font-bold border border-primary/40 hover:bg-primary/20 hover:border-primary transition-all"
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('btn_manual_build')}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 pb-4 pr-1">
            {globalAgents.map((agent) => {
              const Icon = roleIcons[agent.role] || roleIcons.default;
              const colorClass = roleColors[agent.role] || roleColors.default;
              const iconBg = roleIconBg[agent.role] || roleIconBg.default;
              const stripe = roleStripe[agent.role] || roleStripe.default;
              const isSelected = selectedAgent?.id === agent.id;
              return (
                <button
                  key={agent.id}
                  onClick={() => handleSelectAgent(agent)}
                  className={`text-left flex rounded-lg border overflow-hidden transition-all group ${
                    isSelected
                      ? "border-primary bg-primary/10 shadow-[0_0_20px_rgba(153,51,255,0.3)]"
                      : "border-white/10 bg-card hover:border-white/25 hover:bg-white/5"
                  }`}
                >
                  {/* 左侧角色色条 */}
                  <div className={`w-1 shrink-0 ${stripe} opacity-80`} />

                  <div className="flex flex-col flex-1 p-4 min-w-0">
                    <div className="flex items-center gap-3 mb-2.5">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg border shrink-0 ${iconBg}`}>
                        <Icon className="h-4 w-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-white font-mono text-sm truncate">{agent.label}</div>
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border uppercase ${colorClass}`}>{agent.role}</span>
                      </div>
                      <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${isSelected ? "text-primary rotate-90" : "text-white/20 group-hover:text-white/50"}`} />
                    </div>

                    <p className="text-[11px] text-slate-300 font-mono leading-snug line-clamp-2">{agent.description}</p>

                    <div className="mt-3 pt-2 border-t border-white/8 flex gap-3">
                      <span className="text-[10px] font-mono text-slate-400 line-clamp-1 flex-1">
                        <span className="text-violet-400 font-bold mr-1">IN</span>{agent.input || "—"}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 line-clamp-1 flex-1">
                        <span className="text-emerald-400 font-bold mr-1">OUT</span>{agent.output || "—"}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── 右栏：详情/编辑抽屉 ── */}
      {selectedAgent && (
        <div className="w-[340px] shrink-0 flex flex-col border border-primary/30 rounded-lg bg-muted/60 shadow-[0_0_20px_rgba(153,51,255,0.15)] overflow-hidden animate-in slide-in-from-right-4 duration-200">
          {/* 抽屉标题 */}
          <div className="p-4 border-b border-primary/20 bg-primary/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {(() => { const Icon = roleIcons[selectedAgent.role] || roleIcons.default; return <Icon className="h-4 w-4 text-primary" />; })()}
              <span className="font-mono font-bold text-white text-sm tracking-wider truncate max-w-[160px]">{selectedAgent.label}</span>
            </div>
            <div className="flex items-center gap-2">
              {!isDefaultAgent && !isEditing && (
                <button onClick={handleStartEdit} className="p-1.5 text-white/55 hover:text-primary border border-primary/20 hover:border-primary rounded transition-all" title={t('btn_edit')}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
              <button onClick={() => setSelectedAgent(null)} className="p-1.5 text-white/35 hover:text-primary rounded transition-all">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4">
            {isEditing ? (
              /* 编辑模式 */
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-white/55 uppercase">{t('field_facility_code')}</label>
                  <input value={editForm.label} onChange={e => setEditForm({...editForm, label: e.target.value})}
                    className="w-full rounded border border-primary/40 bg-muted/60 p-2 font-mono text-sm text-white focus:border-primary focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-white/55 uppercase">{t('field_type')}</label>
                  <select value={editForm.role} onChange={e => setEditForm({...editForm, role: e.target.value})}
                    className="w-full rounded border border-primary/40 bg-muted/60 p-2 font-mono text-sm text-white focus:border-primary focus:outline-none">
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-white/55 uppercase">{t('field_input_label')}</label>
                  <textarea value={editForm.input} onChange={e => setEditForm({...editForm, input: e.target.value})} rows={3}
                    className="w-full rounded border border-primary/40 bg-muted/60 p-2 font-mono text-sm text-white focus:border-primary focus:outline-none resize-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-green-400/60 uppercase">{t('field_output_label')}</label>
                  <textarea value={editForm.output} onChange={e => setEditForm({...editForm, output: e.target.value})} rows={3}
                    className="w-full rounded border border-green-500/30 bg-muted/60 p-2 font-mono text-sm text-white focus:border-green-500 focus:outline-none resize-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-white/55 uppercase">{t('field_core_directive')}</label>
                  <textarea value={editForm.description} onChange={e => setEditForm({...editForm, description: e.target.value})} rows={3}
                    className="w-full rounded border border-primary/40 bg-muted/60 p-2 font-mono text-sm text-white focus:border-primary focus:outline-none resize-none" />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-white/55 uppercase">{t('field_system_prompt_override')}</label>
                  <textarea value={editForm.system_prompt || ""} onChange={e => setEditForm({...editForm, system_prompt: e.target.value})} rows={4}
                    placeholder={t('placeholder_system_prompt_empty')}
                    className="w-full rounded border border-primary/40 bg-muted/60 p-2 font-mono text-xs text-green-400/80 focus:border-primary focus:outline-none resize-none" />
                </div>

                <div className="flex gap-2">
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] font-mono text-white/55 uppercase">{t('field_llm_model')}</label>
                    <select value={editForm.model || ""} onChange={e => {
                        const profile = llmProfiles.find(p => p.modelId === e.target.value);
                        setEditForm({
                          ...editForm,
                          model: e.target.value,
                          temperature: profile ? profile.temperature : editForm.temperature,
                        });
                      }}
                      className="w-full rounded border border-primary/40 bg-muted/60 p-2 font-mono text-xs text-white focus:border-primary focus:outline-none">
                      <option value="">{t('option_global_default')}</option>
                      {llmProfiles.map(p => (
                        <option key={p.id} value={p.modelId}>{p.name} ({p.modelId})</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-24 space-y-1">
                    <label className="text-[10px] font-mono text-white/55 uppercase">Temperature</label>
                    <input type="number" min="0" max="2" step="0.1" value={editForm.temperature ?? 0.1} onChange={e => setEditForm({...editForm, temperature: e.target.value})}
                      className="w-full rounded border border-primary/40 bg-muted/60 p-2 font-mono text-xs text-white focus:border-primary focus:outline-none" />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button onClick={handleSaveEdit} disabled={isSavingEdit}
                    className="flex-1 py-2.5 bg-primary/20 text-primary font-mono font-bold border border-primary hover:bg-primary hover:text-black transition-all tracking-wider disabled:opacity-50 flex items-center justify-center gap-2">
                    <Save className="h-4 w-4" />
                    {isSavingEdit ? t('saving') : t('btn_save')}
                  </button>
                  <button onClick={handleCancelEdit}
                    className="px-4 py-2.5 text-white/55 font-mono font-bold border border-primary/20 hover:border-primary/50 hover:text-primary transition-all">
                    {t('btn_cancel')}
                  </button>
                </div>
              </div>
            ) : (
              /* 查看模式 */
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-mono font-bold px-2 py-1 rounded border uppercase ${roleColors[selectedAgent.role] || roleColors.default}`}>
                    {selectedAgent.role}
                  </span>
                  {isDefaultAgent && (
                    <span className="text-[10px] font-mono text-white/35 border border-primary/10 px-2 py-0.5 rounded">{t('system_builtin_badge')}</span>
                  )}
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">{t('field_core_directive')}</span>
                  <p className="text-sm text-slate-200 font-mono leading-relaxed">{selectedAgent.description || "—"}</p>
                </div>

                <div className="space-y-2.5 p-3 bg-muted/40 rounded border border-white/10">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-violet-400 uppercase flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" /> {t('field_input_label')}
                    </span>
                    <p className="text-xs text-slate-300 font-mono leading-relaxed pl-4">{selectedAgent.input || "—"}</p>
                  </div>
                  <div className="flex justify-center"><ArrowDown className="h-3 w-3 text-white/20" /></div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-emerald-400 uppercase flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" /> {t('field_output_label')}
                    </span>
                    <p className="text-xs text-slate-300 font-mono leading-relaxed pl-4">{selectedAgent.output || "—"}</p>
                  </div>
                </div>

                {/* System Prompt */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-mono text-green-500/60 uppercase tracking-wider flex items-center gap-1">
                    <Terminal className="h-3 w-3" /> System Prompt
                  </span>
                  {selectedAgent.system_prompt ? (
                    <div className="bg-background/95 p-3 rounded border border-green-500/20 font-mono text-xs text-green-400/80 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto custom-scrollbar">
                      {selectedAgent.system_prompt}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-600 font-mono italic">{t('not_configured_default_prompt')}</p>
                  )}
                </div>

                {/* LLM 配置 */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <Cpu className="h-3 w-3" /> {t('llm_config_label')}
                  </span>
                  <div className="flex gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-violet-500/10 border border-violet-500/20">
                      <span className="text-[10px] font-mono text-slate-500">{t('field_model_label')}</span>
                      <span className="text-xs font-mono font-bold text-violet-300">
                        {selectedAgent.config_json?.model || t('option_global_default')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-primary/10 border border-primary/20">
                      <span className="text-[10px] font-mono text-slate-500">Temp</span>
                      <span className="text-xs font-mono font-bold text-primary/80">
                        {selectedAgent.config_json?.temperature ?? "—"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">{t('field_archive_id')}</span>
                  <p className="text-xs text-slate-600 font-mono">{selectedAgent.id}</p>
                </div>

                {/* 单体测试区 */}
                <div className="space-y-2 pt-2 border-t border-primary/10">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-slate-400 uppercase flex items-center gap-1 font-bold">
                      <Play className="h-3 w-3 text-primary" /> {t('test_fire_section')}
                    </span>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-slate-400 border border-white/10 hover:border-primary/50 hover:text-primary rounded transition-all"
                    >
                      <Upload className="h-3 w-3" /> {t('btn_upload_file')}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.md,.csv,.json,.xml,.yaml,.yml,.log,.ts,.tsx,.js,.py,.pdf,.docx,.doc,.pptx,.xlsx"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </div>
                  {fileHint && (
                    <p className={`text-[10px] font-mono px-2 py-1 rounded ${fileHintIsError ? "text-yellow-400/70 bg-yellow-500/10 border border-yellow-500/20" : "text-green-400/70 bg-green-500/10 border border-green-500/20"}`}>
                      {fileHint}
                    </p>
                  )}
                  <textarea
                    value={testInput}
                    onChange={e => setTestInput(e.target.value)}
                    placeholder={t('placeholder_test_input')}
                    rows={4}
                    className="w-full rounded border border-primary/30 bg-background/95 p-2.5 font-mono text-xs text-white placeholder:text-white/30 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
                  />
                  <button
                    onClick={handleTest}
                    disabled={isTesting || !testInput.trim()}
                    className={`w-full py-2.5 font-mono text-sm font-bold border transition-all tracking-wider flex items-center justify-center gap-2 ${
                      testInput.trim()
                        ? "bg-primary/20 text-white border-primary hover:bg-primary hover:text-black hover:shadow-[0_0_15px_rgba(153,51,255,0.6)] cursor-pointer"
                        : "bg-muted/40 text-slate-600 border-white/10 cursor-not-allowed"
                    }`}
                  >
                    <Play className={`h-4 w-4 ${testInput.trim() ? "text-primary" : "text-slate-700"}`} />
                    {isTesting ? t('testing') : testInput.trim() ? t('btn_test_fire') : t('btn_enter_test_first')}
                  </button>

                  {testResult && (
                    <div className="space-y-1 animate-in fade-in duration-200">
                      {testResult.error ? (
                        <p className="text-xs text-red-400 font-mono p-2 bg-red-500/10 rounded border border-red-500/20">{testResult.error}</p>
                      ) : (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono text-green-400/60 uppercase">{t('test_output_label')}</span>
                            <span className="text-[10px] font-mono text-white/35 flex items-center gap-1">
                              <Clock className="h-2.5 w-2.5" />{testResult.duration_ms}ms · {testResult.model_used}
                            </span>
                          </div>
                          <div className="bg-background/95 p-3 rounded border border-green-500/20 font-mono text-xs text-green-400/80 whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar">
                            {testResult.output}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {!isDefaultAgent && (
                  <button
                    onClick={() => handleDelete(selectedAgent.id)}
                    className="w-full py-2.5 mt-2 bg-red-500/10 text-red-400/70 font-mono font-bold border border-red-500/20 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/40 transition-all tracking-wider flex items-center justify-center gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('btn_destroy_archive')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 手动构筑 Modal ── */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-primary/50 bg-card p-8 shadow-[0_0_40px_rgba(153,51,255,0.3)] animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6 border-b border-primary/30 pb-4">
              <h2 className="text-lg font-bold tracking-widest text-primary flex items-center gap-2">
                <Plus className="h-5 w-5" /> {t('modal_manual_build_title')}
              </h2>
              <button onClick={() => setShowManualModal(false)} className="text-white/55 hover:text-primary"><X className="h-5 w-5" /></button>
            </div>

            <form onSubmit={handleManualCreate} className="space-y-4">
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-mono text-primary/60 uppercase">{t('field_facility_code')}</label>
                  <input required value={formData.label} onChange={e => setFormData({...formData, label: e.target.value})}
                    placeholder={t('placeholder_facility_code')}
                    className="w-full rounded border border-primary/40 bg-muted/60 p-2.5 font-mono text-sm text-white focus:border-primary focus:outline-none" />
                </div>
                <div className="w-36 space-y-1">
                  <label className="text-xs font-mono text-primary/60 uppercase">{t('field_type')}</label>
                  <select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}
                    className="w-full rounded border border-primary/40 bg-muted/60 p-2.5 font-mono text-sm text-white focus:border-primary focus:outline-none">
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                <div className="space-y-1">
                  <label className="text-xs font-mono text-primary uppercase font-bold">{t('field_input_label')}</label>
                  <input required value={formData.input} onChange={e => setFormData({...formData, input: e.target.value})}
                    placeholder={t('placeholder_input')}
                    className="w-full rounded border border-primary/20 bg-muted/40 p-2 font-mono text-sm text-white focus:border-primary focus:outline-none" />
                </div>
                <div className="flex justify-center"><ArrowDown className="h-4 w-4 text-white/25" /></div>
                <div className="space-y-1">
                  <label className="text-xs font-mono text-green-400 uppercase font-bold">{t('field_output_label')}</label>
                  <input required value={formData.output} onChange={e => setFormData({...formData, output: e.target.value})}
                    placeholder={t('placeholder_output')}
                    className="w-full rounded border border-green-500/20 bg-muted/40 p-2 font-mono text-sm text-white focus:border-green-500 focus:outline-none" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono text-primary/60 uppercase">{t('field_core_directive')}</label>
                <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})}
                  placeholder={t('placeholder_core_directive')} rows={3}
                  className="w-full rounded border border-primary/40 bg-muted/60 p-2.5 font-mono text-sm text-white focus:border-primary focus:outline-none resize-none" />
              </div>

              <button type="submit" disabled={isSubmitting}
                className="w-full py-3 bg-primary/20 text-white font-mono font-bold border border-primary hover:bg-primary hover:text-black transition-all tracking-widest disabled:opacity-50">
                {isSubmitting ? t('archiving') : t('btn_confirm_build')}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
