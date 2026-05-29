const getApiBaseUrl = () => {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') {
    // Force IPv4 when the hostname is the loopback alias.
    // Background: uvicorn defaults to binding 127.0.0.1 (IPv4 only). If a developer
    // also runs Docker (or anything else) on IPv6 *:8000, browsers resolve "localhost"
    // to ::1 first, hit the other process, and 404. Pinning to 127.0.0.1 dodges that
    // entire class of bug. Non-loopback hostnames (e.g. LAN dev) pass through unchanged.
    const host = window.location.hostname;
    const ipv4Host = host === 'localhost' ? '127.0.0.1' : host;
    return `http://${ipv4Host}:8000`;
  }
  return 'http://127.0.0.1:8000';
};

export const API_BASE_URL = getApiBaseUrl(); // Keep for legacy exports if needed

export interface Workspace {
  id: number;
  name: string;
  description?: string;
  created_at: string;
}

export interface WorkspaceCreate {
  name: string;
  description?: string;
}

export const api = {
  getWorkspaces: async (): Promise<Workspace[]> => {
    const res = await fetch(`${getApiBaseUrl()}/workspaces/?t=${Date.now()}`);
    if (!res.ok) throw new Error('Failed to fetch workspaces');
    return res.json();
  },

  createWorkspace: async (data: WorkspaceCreate): Promise<Workspace> => {
    const res = await fetch(`${getApiBaseUrl()}/workspaces/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create workspace');
    return res.json();
  },

  deleteWorkspace: async (id: number): Promise<Workspace> => {
    const res = await fetch(`${getApiBaseUrl()}/workspaces/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete workspace');
    return res.json();
  },

  architectAgents: async (prompt: string, currentArchitecture?: { nodes: any[], edges: any[] }, locale = 'zh') => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/commander/architect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, current_architecture: currentArchitecture, locale }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Failed to architect agents');
      return res.json();
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error('协同主脑响应超时（>90秒），请重试');
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  },

  updateCanvas: async (workspaceId: number, canvasData: any): Promise<Workspace> => {
    const res = await fetch(`${getApiBaseUrl()}/workspaces/${workspaceId}/canvas`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ canvas_data: canvasData }),
    });
    if (!res.ok) throw new Error('Failed to update canvas');
    return res.json();
  },

  getAgents: async (workspaceId: number) => {
    const res = await fetch(`${getApiBaseUrl()}/workspaces/${workspaceId}/agents/`);
    if (!res.ok) throw new Error('Failed to fetch agents');
    return res.json();
  },

  createAgent: async (workspaceId: number, agentData: any) => {
    const res = await fetch(`${getApiBaseUrl()}/agents/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...agentData, workspace_id: workspaceId }),
    });
    if (!res.ok) throw new Error('Failed to create agent');
    return res.json();
  },

  updateAgent: async (agentId: number, data: any) => {
    const res = await fetch(`${getApiBaseUrl()}/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update agent');
    return res.json();
  },

  deleteAgent: async (agentId: number) => {
    const res = await fetch(`${getApiBaseUrl()}/agents/${agentId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete agent');
    return res.json();
  },

  executeWorkflow: async (workspaceId: number, initialPayload: string) => {
    const res = await fetch(`${getApiBaseUrl()}/workspaces/${workspaceId}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ initial_payload: initialPayload }),
    });
    if (!res.ok) throw new Error('Failed to execute workflow');
    return res.json();
  },

  executeWorkflowStream: (workspaceId: number, body: {
    initial_payload: string;
    llm_config?: {
      api_key: string | null;
      base_url: string | null;
      model_id: string | null;
      temperature: number | null;
    } | null;
  }): Promise<Response> => {
    return fetch(`${getApiBaseUrl()}/workspaces/${workspaceId}/execute-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  testAgent: async (payload: { label: string; description: string; system_prompt?: string; model?: string; temperature?: number; input_text: string }) => {
    const res = await fetch(`${getApiBaseUrl()}/api/lab/test-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Test failed');
    return res.json();
  },

  generateAgent: async (prompt: string, locale = 'zh') => {
    const res = await fetch(`${getApiBaseUrl()}/api/lab/generate-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, locale }),
    });
    if (!res.ok) throw new Error('Failed to generate agent');
    return res.json();
  },

  getExecutionLogs: async (workspaceId: number) => {
    const res = await fetch(`${getApiBaseUrl()}/workspaces/${workspaceId}/logs`);
    if (!res.ok) throw new Error('Failed to fetch execution logs');
    return res.json();
  },

  /** Returns the URL to trigger a native browser download of the Dockerized workspace zip. */
  exportWorkflowUrl: (workspaceId: number): string => {
    return `${getApiBaseUrl()}/workspaces/${workspaceId}/export`;
  },

  /** Fetches metadata for all backend-registered tools (name, description, recommended roles). */
  listTools: async (): Promise<{ tools: ToolMetadata[] }> => {
    const res = await fetch(`${getApiBaseUrl()}/api/tools`);
    if (!res.ok) throw new Error('Failed to fetch tools');
    return res.json();
  },
};

export interface ToolMetadata {
  name: string;
  label: string;
  description: string;
  recommended_for: string[];
}
