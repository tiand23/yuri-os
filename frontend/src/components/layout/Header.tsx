"use client";

import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";
import { usePathname } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { DownloadCloud } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import { useT } from "@/lib/useT";
import { useI18nStore } from "@/lib/i18n-store";
import { LOCALES } from "@/lib/i18n";

export function Header() {
  const pathname = usePathname();
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
  const t = useT();
  const { locale, setLocale } = useI18nStore();

  // A simple title mapping
  const getPageTitle = () => {
    switch (pathname) {
      case "/":
        return t('page_title_home');
      case "/agents":
        return t('page_title_agents');
      case "/canvas":
        return t('page_title_canvas');
      case "/logs":
        return t('page_title_logs');
      case "/settings":
        return t('page_title_settings');
      default:
        return t('page_title_default');
    }
  };

  const handleExport = () => {
    if (!activeWorkspaceId) return;
    window.location.href = `${API_BASE_URL}/workspaces/${activeWorkspaceId}/export`;
  };

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-primary/20 bg-background/80 px-6 backdrop-blur shadow-[0_4px_24px_rgba(153,51,255,0.05)] z-10">
      <div className="flex items-center">
        <h1 className="text-lg font-bold text-primary tracking-widest drop-shadow-[0_0_4px_rgba(153,51,255,0.5)]">
          {getPageTitle()}
        </h1>
      </div>
      <div className="flex items-center space-x-4">
        <div className="flex items-center gap-1 border border-primary/20 rounded-lg overflow-hidden">
          {LOCALES.map((loc) => (
            <button
              key={loc.value}
              onClick={() => setLocale(loc.value)}
              className={`px-2 py-1 text-xs font-mono transition-colors ${
                locale === loc.value
                  ? 'bg-primary/30 text-primary'
                  : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
              }`}
              title={loc.label}
            >
              {loc.flag} {loc.label}
            </button>
          ))}
        </div>
        {activeWorkspaceId && (
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono font-bold text-primary border border-primary/30 bg-primary/10 hover:bg-primary/20 hover:border-primary/60 transition-all rounded"
          >
            <DownloadCloud className="h-4 w-4" />
            {t('btn_export')}
          </button>
        )}
        <WorkspaceSwitcher />
      </div>
    </header>
  );
}
