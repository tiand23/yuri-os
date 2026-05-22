from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime

# Workspace Schemas
class WorkspaceBase(BaseModel):
    name: str
    description: Optional[str] = None
    canvas_data: Optional[Dict[str, Any]] = None

class WorkspaceCreate(WorkspaceBase):
    pass

class WorkspaceCanvasUpdate(BaseModel):
    canvas_data: Dict[str, Any]

class Workspace(WorkspaceBase):
    id: int
    canvas_data: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True

# AgentConfig Schemas
class AgentConfigBase(BaseModel):
    label: str
    role: str
    description: Optional[str] = None
    input: Optional[str] = None
    output: Optional[str] = None
    config_json: Optional[Dict[str, Any]] = None

class AgentConfigCreate(AgentConfigBase):
    workspace_id: int

class AgentConfigUpdate(BaseModel):
    label: Optional[str] = None
    role: Optional[str] = None
    description: Optional[str] = None
    input: Optional[str] = None
    output: Optional[str] = None
    config_json: Optional[Dict[str, Any]] = None

class AgentConfig(AgentConfigBase):
    id: int
    workspace_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# Execution Schemas
class ExecutionLogBase(BaseModel):
    status: str = "running"
    initial_payload: Optional[str] = None
    final_payload: Optional[str] = None
    logs_json: Optional[List[str]] = None
    results_by_node: Optional[Dict[str, Any]] = None
    nodes_snapshot: Optional[List[Dict[str, Any]]] = None
    execution_time_ms: Optional[int] = None

class ExecutionLogCreate(ExecutionLogBase):
    workspace_id: int

class ExecutionLog(ExecutionLogBase):
    id: int
    workspace_id: int
    created_at: datetime

    class Config:
        from_attributes = True

class LLMConfig(BaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_id: Optional[str] = None
    temperature: Optional[float] = None

class ExecuteRequest(BaseModel):
    initial_payload: str
    llm_config: Optional[LLMConfig] = None

class ExecuteResponse(BaseModel):
    execution_log_id: int
    status: str
    final_payload: str
    logs: list[str]
    results_by_node: Dict[str, str]

# LLM Agent Generation Schemas
class AgentTestRequest(BaseModel):
    label: str
    description: str
    system_prompt: str = ""
    model: str = ""
    temperature: float = 0.1
    input_text: str

class AgentTestResponse(BaseModel):
    output: str
    model_used: str
    duration_ms: int

class AgentGenerationDirective(BaseModel):
    prompt: str
    locale: str = "zh"

class GeneratedAgentConfig(BaseModel):
    label: str
    role: str
    description: str
    input: str
    output: str
    system_prompt: str

# LLM Architecture Generation Schemas
class CommanderDirective(BaseModel):
    prompt: str
    current_architecture: Optional[Dict[str, Any]] = None
    locale: str = "zh"

class AgentNodeSchema(BaseModel):
    id: str
    label: str
    role: str
    description: str
    input: Optional[str] = ""
    output: Optional[str] = ""
    system_prompt: Optional[str] = ""

class AgentEdgeSchema(BaseModel):
    id: str
    source: str
    target: str
    description: str # 描述连线的数据流向或操作，例如“存入DB”、“传递分析报告”

class ArchitectureSchema(BaseModel):
    nodes: List[AgentNodeSchema]
    edges: List[AgentEdgeSchema]
