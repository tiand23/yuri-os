"use client";

import { useState } from "react";
import { useLLMStore, LLMProfile } from "@/lib/llm-store";
import { useT } from "@/lib/useT";
import {
  Settings, Plus, Pencil, Trash2, X, Save,
  Cpu, Eye, EyeOff, CheckCircle2, ChevronRight,
} from "lucide-react";

const EMPTY_FORM = {
  name: "",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  modelId: "deepseek-chat",
  temperature: 0.1,
};

export default function SettingsPage() {
  const t = useT();
  const { profiles, addProfile, updateProfile, deleteProfile } = useLLMStore();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [showKey, setShowKey] = useState(false);

  const isEditing = editingId !== null;

  const openAdd = () => {
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
    setShowKey(false);
    setShowForm(true);
  };

  const openEdit = (p: LLMProfile) => {
    setForm({ name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey, modelId: p.modelId, temperature: p.temperature });
    setEditingId(p.id);
    setShowKey(false);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.name || !form.modelId) return;
    if (isEditing) {
      updateProfile(editingId!, form);
    } else {
      addProfile(form);
    }
    setShowForm(false);
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    if (id === "default_deepseek") return;
    if (!confirm(t('confirm_delete_model'))) return;
    deleteProfile(id);
  };

  const maskedKey = (key: string) =>
    key ? key.slice(0, 6) + "••••••••" + key.slice(-4) : t('apikey_not_set');

  return (
    <div className="max-w-3xl mx-auto space-y-8 p-2">
      {/* 页头 */}
      <div className="border-b border-primary/20 pb-6">
        <h1 className="text-2xl font-bold tracking-widest text-primary flex items-center gap-3">
          <Settings className="h-7 w-7" />
          {t('settings_page_title')}
        </h1>
        <p className="text-slate-500 mt-1 font-mono text-xs tracking-wider uppercase">
          {t('settings_page_subtitle')}
        </p>
      </div>

      {/* LLM 模型库 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white font-mono tracking-wider flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" />
              {t('llm_library_title')}
            </h2>
            <p className="text-slate-500 text-xs font-mono mt-0.5">
              {t('llm_library_desc')}
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 bg-primary/20 text-primary font-mono text-sm font-bold border border-primary/50 hover:bg-primary hover:text-black transition-all tracking-wider"
          >
            <Plus className="h-4 w-4" />
            {t('add_model_btn')}
          </button>
        </div>

        {/* 模型列表 */}
        <div className="space-y-3">
          {profiles.map((p) => {
            const isDefault = p.id === "default_deepseek";
            return (
              <div
                key={p.id}
                className="rounded-lg border border-white/10 bg-card p-4 flex items-start gap-4 group hover:border-white/20 transition-all"
              >
                {/* 左侧图标 */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/20 border border-primary/30 mt-0.5">
                  <Cpu className="h-5 w-5 text-primary" />
                </div>

                {/* 信息 */}
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-white">{p.name}</span>
                    {isDefault && (
                      <span className="text-[10px] font-mono text-primary/60 border border-primary/20 px-1.5 py-0.5 rounded">{t('system_default_badge')}</span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-mono text-slate-500 uppercase">Model ID</span>
                      <div className="flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 text-white/55 shrink-0" />
                        <span className="text-xs font-mono text-violet-300 font-bold">{p.modelId}</span>
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-mono text-slate-500 uppercase">Temperature</span>
                      <div className="flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 text-white/55 shrink-0" />
                        <span className="text-xs font-mono text-slate-300">{p.temperature}</span>
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-mono text-slate-500 uppercase">Base URL</span>
                      <div className="flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 text-white/55 shrink-0" />
                        <span className="text-xs font-mono text-slate-400 truncate">{p.baseUrl}</span>
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-mono text-slate-500 uppercase">API Key</span>
                      <div className="flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 text-white/55 shrink-0" />
                        <span className={`text-xs font-mono ${p.apiKey ? "text-emerald-400" : "text-slate-600"}`}>
                          {p.apiKey ? <><CheckCircle2 className="h-3 w-3 inline mr-1" />{maskedKey(p.apiKey)}</> : t('apikey_not_configured')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEdit(p)}
                    className="p-2 text-slate-400 hover:text-white border border-white/10 hover:border-white/30 rounded transition-all"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {!isDefault && (
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="p-2 text-red-500/50 hover:text-red-400 border border-red-500/10 hover:border-red-500/30 rounded transition-all"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 表单 Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-primary/40 bg-card p-8 shadow-[0_0_40px_rgba(153,51,255,0.25)] animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6 border-b border-primary/20 pb-4">
              <h2 className="text-base font-bold tracking-widest text-primary flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                {isEditing ? t('modal_title_edit') : t('modal_title_add')}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-slate-500 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">{t('field_display_name')}</label>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder={t('placeholder_display_name')}
                  className="w-full rounded border border-white/15 bg-muted/60 p-2.5 font-mono text-sm text-white focus:border-primary focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Model ID *</label>
                <input
                  value={form.modelId}
                  onChange={e => setForm({ ...form, modelId: e.target.value })}
                  placeholder={t('placeholder_model_id')}
                  className="w-full rounded border border-white/15 bg-muted/60 p-2.5 font-mono text-sm text-violet-300 focus:border-primary focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Base URL</label>
                <input
                  value={form.baseUrl}
                  onChange={e => setForm({ ...form, baseUrl: e.target.value })}
                  placeholder="https://api.deepseek.com/v1"
                  className="w-full rounded border border-white/15 bg-muted/60 p-2.5 font-mono text-sm text-slate-300 focus:border-primary focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                  {t('apikey_label_optional')}
                </label>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={form.apiKey}
                    onChange={e => setForm({ ...form, apiKey: e.target.value })}
                    placeholder="sk-..."
                    className="w-full rounded border border-white/15 bg-muted/60 p-2.5 pr-10 font-mono text-sm text-emerald-300 focus:border-primary focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                  {t('temperature_hint')}
                </label>
                <input
                  type="number" min="0" max="2" step="0.1"
                  value={form.temperature}
                  onChange={e => setForm({ ...form, temperature: parseFloat(e.target.value) })}
                  className="w-full rounded border border-white/15 bg-muted/60 p-2.5 font-mono text-sm text-slate-300 focus:border-primary focus:outline-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={!form.name || !form.modelId}
                  className="flex-1 py-3 bg-primary/20 text-white font-mono font-bold border border-primary hover:bg-primary hover:text-black transition-all tracking-wider disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  {isEditing ? t('btn_save_edit') : t('btn_add_to_library')}
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="px-5 py-3 text-slate-400 font-mono font-bold border border-white/10 hover:border-white/30 hover:text-white transition-all"
                >
                  {t('btn_cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
