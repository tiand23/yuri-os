"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrainCircuit, CircuitBoard, Settings, Users, ShieldAlert, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/useT";

export function Sidebar() {
  const pathname = usePathname();
  const t = useT();

  const navigation = [
    { name: t('nav_commander'), href: "/", icon: BrainCircuit },
    { name: t('nav_agents'), href: "/agents", icon: Users },
    { name: t('nav_canvas'), href: "/canvas", icon: CircuitBoard },
    { name: t('nav_logs'), href: "/logs", icon: Zap },
    { name: t('nav_settings'), href: "/settings", icon: Settings },
  ];

  return (
    <div className="flex h-full w-64 flex-col bg-background border-r border-primary/20 shadow-[4px_0_24px_rgba(153,51,255,0.05)] z-10">
      <div className="flex h-16 shrink-0 items-center px-6 border-b border-primary/20">
        <ShieldAlert className="h-6 w-6 text-primary mr-2 animate-pulse" />
        <span className="font-bold text-lg tracking-wider uppercase text-primary drop-shadow-[0_0_8px_rgba(153,51,255,0.8)]">YURI OS</span>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto pt-4">
        <nav className="flex-1 space-y-1 px-3">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  isActive
                    ? "bg-primary/10 text-primary border-r-2 border-primary"
                    : "text-muted-foreground hover:bg-primary/5 hover:text-foreground",
                  "group flex items-center px-3 py-2 text-sm font-medium transition-colors"
                )}
              >
                <item.icon
                  className={cn(
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                    "mr-3 flex-shrink-0 h-5 w-5 transition-colors"
                  )}
                  aria-hidden="true"
                />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
