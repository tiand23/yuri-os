"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";

import { useT } from "@/lib/useT";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspaceId, setWorkspaces, setActiveWorkspaceId } = useAppStore();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [showNewWorkspaceDialog, setShowNewWorkspaceDialog] = useState(false);
  
  // Form state
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceDesc, setNewWorkspaceDesc] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const loadWorkspaces = async () => {
      try {
        const data = await api.getWorkspaces();
        setWorkspaces(data);
        if (!activeWorkspaceId && data.length > 0) {
          setActiveWorkspaceId(data[0].id);
        } else if (activeWorkspaceId && !data.find((w) => w.id === activeWorkspaceId)) {
          setActiveWorkspaceId(data.length > 0 ? data[0].id : null);
        }
      } catch (error: any) {
        console.error("Failed to load workspaces", error);
        alert(t('error_backend_firewall') + error.message);
      }
    };
    loadWorkspaces();
  }, [setWorkspaces, activeWorkspaceId, setActiveWorkspaceId]);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const handleDeleteWorkspace = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm(t('confirm_delete_workspace'))) return;
    try {
      await api.deleteWorkspace(id);
      const updated = workspaces.filter(w => w.id !== id);
      setWorkspaces(updated);
      if (activeWorkspaceId === id) {
        setActiveWorkspaceId(updated.length > 0 ? updated[0].id : null);
      }
    } catch (err) {
      console.error("Failed to delete workspace", err);
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;
    
    setIsSubmitting(true);
    try {
      const newWs = await api.createWorkspace({
        name: newWorkspaceName,
        description: newWorkspaceDesc,
      });
      setWorkspaces([...workspaces, newWs]);
      setActiveWorkspaceId(newWs.id);
      setShowNewWorkspaceDialog(false);
      setNewWorkspaceName("");
      setNewWorkspaceDesc("");
    } catch (error) {
      console.error("Failed to create workspace", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderTrigger = () => {
    if (workspaces.length === 0) {
      return (
        <button
          onClick={async () => {
            const name = window.prompt(t('prompt_new_workspace_name'));
            if (!name) return;
            try {
              alert(t('creating_workspace'));
              const newWs = await api.createWorkspace({ name, description: "Auto-created" });
              setWorkspaces([newWs]);
              setActiveWorkspaceId(newWs.id);
              alert(t('workspace_created'));
            } catch (err: any) {
              alert(t('error_workspace_create') + err.message);
            }
          }}
          className="flex h-10 w-[200px] items-center justify-between rounded-lg px-4 py-2 text-sm font-medium border transition-colors focus:outline-none bg-primary/30 border-primary text-primary animate-pulse shadow-[0_0_15px_rgba(153,51,255,0.5)]"
        >
          <span>{t('must_create_workspace')}</span>
          <Plus className="ml-auto h-4 w-4 shrink-0" />
        </button>
      );
    }

    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          className={`flex h-10 w-[200px] items-center justify-between rounded-lg px-4 py-2 text-sm font-medium border transition-colors focus:outline-none ${
            !activeWorkspace ? "bg-primary/30 border-primary text-primary animate-pulse shadow-[0_0_15px_rgba(153,51,255,0.5)]" : "bg-primary/10 border-primary/20 hover:bg-primary/20 hover:text-primary"
          }`}
        >
          {activeWorkspace ? activeWorkspace.name : t('placeholder_select_workspace')}
          <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[200px] bg-background/95 backdrop-blur border-primary/20">
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{t('established_workspaces')}</div>
          <DropdownMenuSeparator className="bg-primary/10" />
          
          {workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              onPointerDown={() => {
                setActiveWorkspaceId(workspace.id);
                setOpen(false);
              }}
              className="cursor-pointer flex justify-between items-center group"
            >
              <span className="flex-1 truncate">{workspace.name}</span>
              <div className="flex items-center gap-1 shrink-0">
                {activeWorkspaceId === workspace.id && <Check className="h-4 w-4 text-primary" />}
                <button
                  onPointerDown={(e) => handleDeleteWorkspace(e, workspace.id)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-red-500/50 hover:text-red-400 transition-all"
                  title={t('btn_destroy_workspace')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </DropdownMenuItem>
          ))}
          
          <DropdownMenuSeparator className="bg-primary/10" />
          
          <DropdownMenuItem
            onPointerDown={() => {
              setOpen(false);
              setTimeout(() => setShowNewWorkspaceDialog(true), 100);
            }}
            className="cursor-pointer text-primary focus:text-primary focus:bg-primary/20"
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('btn_new_workspace')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <>
      {renderTrigger()}

      <Dialog open={showNewWorkspaceDialog} onOpenChange={setShowNewWorkspaceDialog}>
        <DialogContent className="sm:max-w-[425px] bg-background/95 backdrop-blur border-primary/20">
          <DialogHeader>
            <DialogTitle className="text-primary tracking-widest font-mono">{t('dialog_title_create_workspace')}</DialogTitle>
            <DialogDescription className="text-primary/70 text-xs">
              {t('dialog_desc_create_workspace')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateWorkspace}>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right text-primary/80 text-xs">
                  {t('field_workspace_code')}
                </Label>
                <Input
                  id="name"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  placeholder={t('placeholder_workspace_code')}
                  className="col-span-3 bg-muted/40 border-primary/30 text-white focus-visible:ring-primary focus-visible:border-primary"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="desc" className="text-right text-primary/80 text-xs">
                  {t('field_workspace_desc')}
                </Label>
                <Input
                  id="desc"
                  value={newWorkspaceDesc}
                  onChange={(e) => setNewWorkspaceDesc(e.target.value)}
                  placeholder={t('placeholder_optional')}
                  className="col-span-3 bg-muted/40 border-primary/30 text-white focus-visible:ring-primary focus-visible:border-primary"
                />
              </div>
            </div>
            <DialogFooter>
              <Button 
                type="submit" 
                disabled={!newWorkspaceName.trim() || isSubmitting}
                className="bg-primary/80 hover:bg-primary text-white font-mono tracking-widest"
              >
                {isSubmitting ? t('btn_creating') : t('btn_confirm_create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
