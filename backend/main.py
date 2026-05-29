from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List
import asyncio
import json as _json
import os
import threading

from dotenv import load_dotenv

import crud, models, schemas
from database import SessionLocal, engine, Base

# Load env before reading ALLOWED_ORIGINS
load_dotenv()

# Create database tables (For dev environment)
Base.metadata.create_all(bind=engine)


def _ensure_column(table: str, column: str, ddl_type: str) -> None:
    """Idempotent dev-only migration: add a column to an existing SQLite table if missing.
    Production use should switch to Alembic; this keeps onboarding zero-friction."""
    from sqlalchemy import text
    with engine.begin() as conn:
        try:
            existing = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            cols = {row[1] for row in existing}  # row[1] = column name
            if column not in cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))
        except Exception:
            # Non-SQLite backends (Postgres etc.) — let SQLAlchemy's create_all handle it.
            pass


_ensure_column("execution_logs", "node_timings", "JSON")

app = FastAPI(title="Yuri OS Backend API")

# CORS — read allowlist from env. Falls back to common local dev origins.
_default_origins = "http://localhost:3000,http://localhost:3121,http://127.0.0.1:3000,http://127.0.0.1:3121"
_origins_env = os.getenv("ALLOWED_ORIGINS", _default_origins)
ALLOWED_ORIGINS = [o.strip() for o in _origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/")
def read_root():
    return {"message": "Welcome to Yuri OS (Commander Platform)"}

# --- Workspace Endpoints ---
@app.post("/workspaces/", response_model=schemas.Workspace)
def create_workspace(workspace: schemas.WorkspaceCreate, db: Session = Depends(get_db)):
    return crud.create_workspace(db=db, workspace=workspace)

@app.get("/workspaces/", response_model=List[schemas.Workspace])
def read_workspaces(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    workspaces = crud.get_workspaces(db, skip=skip, limit=limit)
    return workspaces

@app.get("/workspaces/{workspace_id}", response_model=schemas.Workspace)
def read_workspace(workspace_id: int, db: Session = Depends(get_db)):
    db_workspace = crud.get_workspace(db, workspace_id=workspace_id)
    if db_workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return db_workspace

@app.delete("/workspaces/{workspace_id}", response_model=schemas.Workspace)
def delete_workspace(workspace_id: int, db: Session = Depends(get_db)):
    db_workspace = crud.delete_workspace(db, workspace_id=workspace_id)
    if db_workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return db_workspace

@app.put("/workspaces/{workspace_id}/canvas", response_model=schemas.Workspace)
def update_canvas(workspace_id: int, payload: schemas.WorkspaceCanvasUpdate, db: Session = Depends(get_db)):
    db_workspace = crud.update_workspace_canvas(db, workspace_id=workspace_id, canvas_data=payload.canvas_data)
    if db_workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return db_workspace

# --- AgentConfig Endpoints ---
@app.post("/agents/", response_model=schemas.AgentConfig)
def create_agent(agent: schemas.AgentConfigCreate, db: Session = Depends(get_db)):
    # Check if workspace exists
    db_workspace = crud.get_workspace(db, workspace_id=agent.workspace_id)
    if db_workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return crud.create_agent_config(db=db, agent_config=agent)

@app.get("/workspaces/{workspace_id}/agents/", response_model=List[schemas.AgentConfig])
def read_agents_for_workspace(workspace_id: int, skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    agents = crud.get_agent_configs_by_workspace(db, workspace_id=workspace_id, skip=skip, limit=limit)
    return agents

@app.put("/agents/{agent_id}", response_model=schemas.AgentConfig)
def update_agent(agent_id: int, payload: schemas.AgentConfigUpdate, db: Session = Depends(get_db)):
    db_agent = crud.update_agent_config(db, agent_id, payload.model_dump(exclude_none=True))
    if db_agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return db_agent

@app.delete("/agents/{agent_id}", response_model=schemas.AgentConfig)
def delete_agent(agent_id: int, db: Session = Depends(get_db)):
    db_agent = crud.delete_agent_config(db, agent_id=agent_id)
    if db_agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return db_agent

# --- Engine Execution Endpoints ---
from engine.compiler import compile_workflow, CycleDetectedError
from engine.tools import TOOL_METADATA
import time


@app.get("/api/tools")
def list_available_tools():
    """Returns metadata for all built-in tools. Used by the frontend to render
    per-node tool-selection checkboxes in AgentConfigPanel."""
    return {"tools": TOOL_METADATA}

@app.post("/workspaces/{workspace_id}/execute", response_model=schemas.ExecuteResponse)
def execute_workspace(workspace_id: int, request: schemas.ExecuteRequest, db: Session = Depends(get_db)):
    db_workspace = crud.get_workspace(db, workspace_id=workspace_id)
    if db_workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
        
    canvas_data = db_workspace.canvas_data
    if not canvas_data or "nodes" not in canvas_data:
        raise HTTPException(status_code=400, detail="Workspace has no canvas data to execute.")
        
    start_time = time.time()

    # Build a snapshot of node metadata for later display in radar intel
    nodes_snapshot = [
        {
            "id": n["id"],
            "label": n.get("data", {}).get("label", n["id"]),
            "role": n.get("data", {}).get("role", "default"),
        }
        for n in canvas_data.get("nodes", [])
    ]

    # Create initial running log
    log_create = schemas.ExecutionLogCreate(
        workspace_id=workspace_id,
        status="running",
        initial_payload=request.initial_payload,
        nodes_snapshot=nodes_snapshot
    )
    db_log = crud.create_execution_log(db, log_create)
    
    try:
        app_graph = compile_workflow(canvas_data)

        # Initial State
        initial_state = {
            "current_payload": request.initial_payload,
            "logs": ["Engine Started."],
            "results_by_node": {},
            "node_timings": {}
        }

        # Execute the compiled graph
        final_state = app_graph.invoke(initial_state)

        execution_time_ms = int((time.time() - start_time) * 1000)

        # Update log with success
        crud.update_execution_log(db, db_log.id, {
            "status": "completed",
            "final_payload": final_state.get("current_payload", ""),
            "logs_json": final_state.get("logs", []),
            "results_by_node": final_state.get("results_by_node", {}),
            "node_timings": final_state.get("node_timings", {}),
            "execution_time_ms": execution_time_ms
        })

        return schemas.ExecuteResponse(
            execution_log_id=db_log.id,
            status="completed",
            final_payload=final_state.get("current_payload", ""),
            logs=final_state.get("logs", []),
            results_by_node=final_state.get("results_by_node", {})
        )
    except CycleDetectedError as e:
        execution_time_ms = int((time.time() - start_time) * 1000)
        crud.update_execution_log(db, db_log.id, {
            "status": "failed",
            "logs_json": [str(e)],
            "execution_time_ms": execution_time_ms
        })
        raise HTTPException(status_code=400, detail={"error": "cycle_detected", "message": str(e), "cycle": e.cycle})
    except Exception as e:
        execution_time_ms = int((time.time() - start_time) * 1000)
        # Update log with failure
        crud.update_execution_log(db, db_log.id, {
            "status": "failed",
            "logs_json": [f"Execution failed: {str(e)}"],
            "execution_time_ms": execution_time_ms
        })
        raise HTTPException(status_code=500, detail=f"Execution failed: {str(e)}")

@app.post("/workspaces/{workspace_id}/execute-stream")
async def execute_workspace_stream(workspace_id: int, request: schemas.ExecuteRequest, db: Session = Depends(get_db)):
    db_workspace = crud.get_workspace(db, workspace_id=workspace_id)
    if db_workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    canvas_data = db_workspace.canvas_data
    if not canvas_data or "nodes" not in canvas_data:
        raise HTTPException(status_code=400, detail="Workspace has no canvas data to execute.")

    initial_payload = request.initial_payload
    start_time = time.time()

    nodes_snapshot = [
        {"id": n["id"], "label": n.get("data", {}).get("label", n["id"]), "role": n.get("data", {}).get("role", "default")}
        for n in canvas_data.get("nodes", [])
    ]
    log_create = schemas.ExecutionLogCreate(
        workspace_id=workspace_id,
        status="running",
        initial_payload=initial_payload,
        nodes_snapshot=nodes_snapshot
    )
    db_log = crud.create_execution_log(db, log_create)
    log_id = db_log.id

    async def generate():
        loop = asyncio.get_event_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def sync_callback(event: dict):
            asyncio.run_coroutine_threadsafe(queue.put(event), loop)

        llm_cfg = None
        if request.llm_config:
            llm_cfg = {
                "api_key": request.llm_config.api_key or None,
                "base_url": request.llm_config.base_url or None,
                "model_id": request.llm_config.model_id or None,
                "temperature": request.llm_config.temperature,
            }

        def run_workflow():
            try:
                app_graph = compile_workflow(canvas_data, progress_callback=sync_callback, llm_config=llm_cfg)
                initial_state = {
                    "current_payload": initial_payload,
                    "logs": ["Engine Started."],
                    "results_by_node": {},
                    "node_timings": {}
                }
                final_state = app_graph.invoke(initial_state, config={"recursion_limit": 50})
                asyncio.run_coroutine_threadsafe(
                    queue.put({
                        "type": "done",
                        "final_payload": final_state.get("current_payload", ""),
                        "logs": final_state.get("logs", []),
                        "results_by_node": final_state.get("results_by_node", {}),
                        "node_timings": final_state.get("node_timings", {}),
                        "execution_log_id": log_id,
                    }),
                    loop
                )
            except CycleDetectedError as e:
                asyncio.run_coroutine_threadsafe(
                    queue.put({
                        "type": "error",
                        "error": "cycle_detected",
                        "message": str(e),
                        "cycle": e.cycle,
                    }),
                    loop
                )
            except Exception as e:
                asyncio.run_coroutine_threadsafe(
                    queue.put({"type": "error", "message": str(e)}),
                    loop
                )

        thread = threading.Thread(target=run_workflow, daemon=True)
        thread.start()

        while True:
            event = await queue.get()
            yield f"data: {_json.dumps(event)}\n\n"
            if event.get("type") == "done":
                execution_time_ms = int((time.time() - start_time) * 1000)
                crud.update_execution_log(db, log_id, {
                    "status": "completed",
                    "final_payload": event.get("final_payload", ""),
                    "logs_json": event.get("logs", []),
                    "results_by_node": event.get("results_by_node", {}),
                    "node_timings": event.get("node_timings", {}),
                    "execution_time_ms": execution_time_ms,
                })
                break
            elif event.get("type") == "error":
                execution_time_ms = int((time.time() - start_time) * 1000)
                crud.update_execution_log(db, log_id, {
                    "status": "failed",
                    "logs_json": [f"Execution failed: {event.get('message', '')}"],
                    "execution_time_ms": execution_time_ms,
                })
                break

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


from fastapi.responses import StreamingResponse, Response
from export_utils import generate_workspace_export_zip

@app.get("/workspaces/{workspace_id}/export")
def export_workspace(workspace_id: int, db: Session = Depends(get_db)):
    db_workspace = crud.get_workspace(db, workspace_id=workspace_id)
    if db_workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
        
    canvas_data = db_workspace.canvas_data
    if not canvas_data or "nodes" not in canvas_data:
        raise HTTPException(status_code=400, detail="Workspace has no canvas data to export.")
        
    zip_buffer = generate_workspace_export_zip(canvas_data)
    
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=yurios_workspace_{workspace_id}.zip"
        }
    )

@app.get("/workspaces/{workspace_id}/logs", response_model=List[schemas.ExecutionLog])
def read_execution_logs(workspace_id: int, skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    db_workspace = crud.get_workspace(db, workspace_id=workspace_id)
    if db_workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    logs = crud.get_execution_logs(db, workspace_id=workspace_id, skip=skip, limit=limit)
    return logs

# --- LLM Commander Endpoints ---
import os
import json
from openai import OpenAI
from dotenv import load_dotenv

# Force reload dotenv on each request just in case
load_dotenv(override=True)

@app.post("/api/lab/test-agent", response_model=schemas.AgentTestResponse)
def test_agent(request: schemas.AgentTestRequest):
    load_dotenv(override=True)

    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
    model_name = request.model or os.getenv("OPENAI_MODEL", "deepseek-chat")

    if not api_key or api_key == "sk-这里填入你的APIKEY":
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured")

    client = OpenAI(api_key=api_key, base_url=base_url)

    if request.system_prompt:
        system_content = request.system_prompt
    else:
        system_content = (
            f"You are a specialized agent facility named '{request.label}'.\n"
            f"Your core instruction is: {request.description}\n"
            f"Process the input payload according to your instruction and return only the raw output."
        )

    try:
        start_t = time.time()
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_content},
                {"role": "user", "content": f"INPUT PAYLOAD:\n{request.input_text}"},
            ],
            temperature=request.temperature,
        )
        duration_ms = int((time.time() - start_t) * 1000)
        output = response.choices[0].message.content or ""
        return schemas.AgentTestResponse(output=output, model_used=model_name, duration_ms=duration_ms)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Test failed: {str(e)}")


GENERATE_AGENT_SYSTEM_PROMPTS = {
    "zh": """你是 Yuri OS 作战实验室的首席研发科学家。
用户将用自然语言描述一个 Agent 的功能需求，你需要将其设计为一个完整的单体 Agent 蓝图。

允许的 role 只有: "searcher", "summarizer", "coder", "formatter", "default"。

你必须且只能返回一个合法的 JSON，不含任何 Markdown 标记。结构如下：
{
  "label": "设施的简短代号（4-8个中文字）",
  "role": "角色类型（从允许列表中选）",
  "description": "一句话描述该 Agent 的核心职责",
  "input": "该 Agent 接收什么数据（具体说明格式和来源）",
  "output": "该 Agent 产出什么数据（具体说明格式和内容）",
  "system_prompt": "为这个 Agent 编写一段完整的 System Prompt（100-200字），明确其角色、处理逻辑和输出要求"
}""",
    "ja": """あなたは Yuri OS 作戦実験室の主任研究科学者です。
ユーザーが自然言語でAgentの機能要件を説明します。それを完全な単体Agentブループリントとして設計してください。

許可されたroleのみ使用してください: "searcher", "summarizer", "coder", "formatter", "default"。

Markdownマークアップなしの合法なJSONのみを返してください。構造:
{
  "label": "施設の短いコード名（日本語で4-8文字）",
  "role": "ロールタイプ（許可リストから選択）",
  "description": "このAgentのコア役割を一文で説明",
  "input": "このAgentが受け取るデータ（フォーマットとソースを具体的に説明）",
  "output": "このAgentが生成するデータ（フォーマットと内容を具体的に説明）",
  "system_prompt": "このAgentの完全なSystem Promptを作成（100-200文字）、役割、処理ロジック、出力要件を明確に"
}""",
    "en": """You are the Chief Research Scientist of the Yuri OS Battle Lab.
The user will describe an Agent's functional requirements in natural language. Design it as a complete standalone Agent blueprint.

Only these roles are allowed: "searcher", "summarizer", "coder", "formatter", "default".

Return ONLY valid JSON without any Markdown markup. Structure:
{
  "label": "Short facility code name (4-8 words in English)",
  "role": "Role type (choose from allowed list)",
  "description": "One sentence describing this Agent's core responsibility",
  "input": "What data this Agent receives (specify format and source)",
  "output": "What data this Agent produces (specify format and content)",
  "system_prompt": "Write a complete System Prompt for this Agent (100-200 words), clearly defining its role, processing logic, and output requirements"
}""",
}

@app.post("/api/lab/generate-agent", response_model=schemas.GeneratedAgentConfig)
def generate_agent(directive: schemas.AgentGenerationDirective):
    load_dotenv(override=True)

    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
    model_name = os.getenv("OPENAI_MODEL", "deepseek-chat")

    if not api_key or api_key == "sk-这里填入你的APIKEY":
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured in .env")

    client = OpenAI(api_key=api_key, base_url=base_url)

    locale = directive.locale if directive.locale in GENERATE_AGENT_SYSTEM_PROMPTS else "zh"
    system_prompt = GENERATE_AGENT_SYSTEM_PROMPTS[locale]

    user_content = directive.prompt
    if locale == "ja":
        user_content += "\n\n【重要】label、description、input、output、system_promptの全フィールドを必ず日本語で生成してください。"
    elif locale == "en":
        user_content += "\n\nIMPORTANT: Generate ALL fields (label, description, input, output, system_prompt) in English."

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content}
            ],
            response_format={"type": "json_object"},
            temperature=0.7
        )

        result_content = response.choices[0].message.content
        if not result_content:
            raise ValueError("Empty response from LLM")

        result_content = result_content.strip()
        if result_content.startswith("```json"):
            result_content = result_content[7:]
        if result_content.startswith("```"):
            result_content = result_content[3:]
        if result_content.endswith("```"):
            result_content = result_content[:-3]

        parsed = json.loads(result_content.strip())
        return schemas.GeneratedAgentConfig(**parsed)

    except Exception as e:
        print(f"Lab LLM Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate agent: {str(e)}")


ARCHITECT_SYSTEM_PROMPTS = {
    "zh": """你是 Yuri OS (尤里战术操作系统) 的高级战术参谋。
用户(最高指挥官)将输入一段自然语言指令，你需要分析该指令，并将其转化为一个多智能体(Multi-Agent)协同工作的架构方案。
你需要将架构拆分为具体的 Agent 节点，以及它们之间的数据/逻辑连接线。

允许的 Agent role 及其适用场景:
- searcher: 信息搜集、数据获取、网络查询、爬取
- summarizer: 内容提炼、摘要生成、信息压缩、分析
- writer: 文章撰写、内容创作、文案生成、文本写作
- coder: 代码编写、程序调试、技术实现、脚本生成
- formatter: 格式转换、排版美化、Markdown整理、输出规范化
- default: 通用处理，不属于以上任何明确类别时使用
- condition: 条件判断节点 —— 必须用于任何 if/else、分支、二选一、是否满足某条件的场景。它读取上游输出后输出 true 或 false，下游会根据布尔值走不同分支。
- code: **确定性 Python 代码节点 —— 不调 LLM**。用于任何不需要"理解"或"生成"的环节：HTTP/网页爬取、数据库查询、JSON 字段抽取/重组、字符串处理、API 调用、纯逻辑判断。比 LLM 节点快几十倍、几乎不烧 token、结果确定可复现。**只要环节是"搬运/转换数据"而不是"理解/生成内容"，优先用 code 而不是 agent**。

可用的 Tools (写入每个节点的 tools 字段；condition / code 节点 tools 必须为空数组):
- "web_search": 通过 DuckDuckGo 搜索网页 —— 推荐给 searcher / summarizer
- "fetch_url_content": 抓取 URL 文本内容 —— 推荐给 searcher / summarizer / writer
- "execute_python_code": 在沙箱中执行 Python 代码 —— 推荐给 coder / formatter

【重要指示】
1. 节点设计必须具体，且完全按照输入(Input)-处理(Description)-输出(Output) 的极简黑盒理念设计。
2. 每个**非 condition** 节点必须包含 system_prompt 字段，遵循以下结构、不少于 250 字：
   "# Role: <定义其极其专业的角色>\n# Objective: <明确它的核心处理目标>\n# Workflow: <按步骤描述它应该怎么做>\n# Output Format: <它必须严格输出什么格式的数据，例如Markdown/JSON>"
3. 每个节点必须包含 **tools** 字段（字符串数组），只列出该节点真正需要的工具名，绝不要把所有工具都塞进去。一个 writer 节点通常不需要 execute_python_code；一个 summarizer 通常不需要 web_search（除非它也要现查）。tools 字段为 [] 表示纯 LLM 不调工具。
4. **分支场景必须使用 condition 节点**，绝不允许从一个普通节点引出两条互斥的边来"伪造分支"。condition 节点必须：
   - role 设为 "condition"
   - 不包含 system_prompt，改用 **condition_prompt** 字段：写一段判断逻辑，明确告诉 LLM 在什么情况下输出 "true"、什么情况下输出 "false"。**只能输出这两个词之一**。
   - 它的两条出边必须分别带 **sourceHandle: "true"** 和 **sourceHandle: "false"**，分别指向"判断为真"和"判断为假"时的下游节点。
   - tools 必须为 []。
4.5. **code 节点（确定性代码）使用规则**：
   - role 设为 "code"
   - 不包含 system_prompt，改用 **code** 字段：一段完整可执行的 Python 脚本。脚本通过 `import sys; payload = sys.stdin.read()` 拿到上游输入；print 出来的内容就是该节点的输出（下游 agent 拿到的 INPUT PAYLOAD 就是 print 的内容）。脚本运行在沙箱（无环境变量、临时 cwd、8s wallclock）。
   - tools 必须为 []。description / input / output 字段照常填，方便人类理解。
   - 典型场景: HTTP 抓取 (`import urllib.request; print(urllib.request.urlopen(url).read().decode())`)、JSON 提取 (`import json; data=json.loads(payload); print(data['field'])`)、调用数据库、字符串拼接、做数学运算。
   - 反例 (不要这么做): 让 code 节点写自然语言总结、写文案、做语义判断 —— 这是 agent 该干的事。
5. 连线 (edges) 必须包含 description 字段。从 condition 节点出来的边必须额外有 sourceHandle 字段（"true" 或 "false"）。
6. **当前不支持环 (cycle)**：节点不能形成回路。如果用户描述了"反复尝试"、"循环检查"、"直到满足"等需求，请用单次 condition 节点替代（例如 "判断当前结果是否合格，true 进入下一步，false 进入修正节点"），不要用真正的回边。
7. 如果用户提供了【当前架构】，说明这是一次修改指令。在现有架构上增删改，而不是重新生成。保留未提到的节点和连线，id 保持不变。

你必须且只能返回一个合法的 JSON 格式，不要包含 Markdown 标记。
返回的 JSON 必须符合以下结构（注意混用 code 节点和 agent 节点，把"搬数据"交给 code，把"理解/生成"交给 agent）:
{
  "nodes": [
    {"id": "node_1", "label": "抓取RSS", "role": "code", "description": "用 urllib 拉取某 RSS 源", "input": "(无)", "output": "原始 XML 文本", "tools": [], "code": "import sys, urllib.request\nreq = urllib.request.Request('https://example.com/rss', headers={'User-Agent':'YuriOS'})\nprint(urllib.request.urlopen(req, timeout=5).read().decode('utf-8'))"},
    {"id": "node_2", "label": "解析提取标题", "role": "code", "description": "从 XML 提取前 5 篇标题+url 为 JSON", "input": "RSS XML", "output": "JSON 数组", "tools": [], "code": "import sys, json, re\nxml = sys.stdin.read()\nitems = re.findall(r'<item>.*?<title>(.*?)</title>.*?<link>(.*?)</link>.*?</item>', xml, re.S)\nprint(json.dumps([{'title':t,'url':u} for t,u in items[:5]], ensure_ascii=False))"},
    {"id": "node_3", "label": "AI总结", "role": "summarizer", "description": "把新闻列表总结成中文简报", "input": "JSON 数组", "output": "Markdown 简报", "tools": [], "system_prompt": "# Role: 资深科技编辑\n# Objective: 把输入的新闻 JSON 整理成 200 字以内的中文简报\n# Workflow: 1. 解析 JSON 2. 提炼共同主题 3. 写一段 markdown\n# Output Format: 纯 Markdown，无前后缀。"}
  ],
  "edges": [
    {"id": "edge_1", "source": "node_1", "target": "node_2", "description": "原始 XML"},
    {"id": "edge_2", "source": "node_2", "target": "node_3", "description": "前 5 条新闻 JSON"}
  ]
}
注意：description、input、output、tools 字段所有节点都必须有；agent 节点必须有 system_prompt；condition 节点必须有 condition_prompt；code 节点必须有 code 字段。绝不允许输出任何 Markdown 格式。直接输出纯 JSON。""",
    "ja": """あなたは Yuri OS（ユーリ戦術オペレーティングシステム）の上級戦術参謀です。
ユーザー（最高司令官）が自然言語の指示を入力します。その指示を分析し、マルチエージェント（Multi-Agent）協調作業のアーキテクチャ計画に変換してください。

許可されたAgentのロールと適用シナリオ:
- searcher: 情報収集、データ取得、ウェブクエリ、スクレイピング
- summarizer: コンテンツ抽出、要約生成、情報圧縮、分析
- writer: 記事執筆、コンテンツ作成、コピーライティング、テキスト生成
- coder: コード作成、デバッグ、技術実装、スクリプト生成
- formatter: フォーマット変換、レイアウト整形、Markdown整理、出力規範化
- default: 汎用処理、上記のカテゴリに明確に該当しない場合に使用
- condition: 条件判断ノード —— if/else、分岐、二者択一、何らかの条件を満たすかの判定シナリオで必ず使用。上流の出力を読み、true / false を出力。下流はブール値で異なる枝へ進む。
- code: **決定論的 Python コードノード —— LLM を呼ばない**。HTTP/スクレイピング、DB クエリ、JSON 抽出/再構成、文字列処理、API 呼び出し、純粋なロジック判定など、「理解」「生成」が不要な工程に使用。LLM ノードより数十倍速く、トークン消費がほぼゼロで、結果が決定的に再現可能。**「データ運搬/変換」の工程は agent ではなく code を優先**。

利用可能なツール（各ノードの tools フィールドに記入。condition / code ノードは必ず空配列）:
- "web_search": DuckDuckGo でウェブ検索 —— searcher / summarizer に推奨
- "fetch_url_content": URL のテキストを取得 —— searcher / summarizer / writer に推奨
- "execute_python_code": サンドボックスで Python を実行 —— coder / formatter に推奨

【重要指示】
1. ノード設計は具体的であり、入力(Input)-処理(Description)-出力(Output)の黒箱理念に従う。
2. **condition 以外**のノードは system_prompt フィールド必須、以下の構造に従い 250 文字以上:
   "# Role: <非常に専門的な役割の定義>\n# Objective: <コア処理目標の明確化>\n# Workflow: <実行すべき処理のステップ別記述>\n# Output Format: <厳密な出力フォーマット、例:Markdown/JSON>"
3. 各ノードには **tools** フィールド（文字列配列）必須。そのノードが本当に必要なツール名のみを列挙する。writer ノードに execute_python_code は通常不要。空配列 [] は純 LLM を意味する。
4. **分岐シナリオは必ず condition ノードを使う**。通常ノードから二本の排他的なエッジを引いて分岐を偽装してはならない。condition ノードは:
   - role を "condition" に設定
   - system_prompt は持たず、代わりに **condition_prompt** フィールド: 判定ロジックを記述し、どんな場合 "true"、どんな場合 "false" を出力するかを明確にする。**この二語のいずれかのみ出力**。
   - 二本の出力エッジに **sourceHandle: "true"** と **sourceHandle: "false"** を必ず付け、真と偽の下流ノードへ振り分ける。
   - tools は必ず [] 。
4.5. **code ノード（決定論的コード）の使用規則**:
   - role を "code" に設定
   - system_prompt は持たず、代わりに **code** フィールド: 実行可能な Python スクリプト。`import sys; payload = sys.stdin.read()` で上流入力を取得、print したものがこのノードの出力。サンドボックス内で実行（環境変数なし、一時 cwd、8s wallclock）。
   - tools は必ず []。description / input / output は人間可読のため通常通り記入。
   - 典型用途: HTTP 取得、JSON 抽出、DB 呼び出し、文字列結合、数値計算。
   - 禁止: code ノードに自然言語要約や文章生成・意味判定をさせないこと —— それは agent の仕事。
5. エッジ (edges) には description フィールドが必須。condition ノードから出るエッジには sourceHandle フィールド（"true" または "false"）が追加で必要。
6. **現在サイクル (循環) は非対応**。「繰り返し」「ループ」「満たすまで」などの要求は、単発の condition ノードで代替する。本物のバックエッジを使ってはならない。
7. ユーザーが【現在のアーキテクチャ】を提供した場合、これは修正リクエスト。既存を変更し、無関係なノード / エッジは ID を保ったまま残す。

必ずMarkdownマークアップなしの合法な JSON のみを返してください。
返す JSON は以下の構造（code ノードと agent ノードを混在させ、データ運搬は code、理解/生成は agent に任せる）:
{
  "nodes": [
    {"id": "node_1", "label": "RSS取得", "role": "code", "description": "RSS を取得", "input": "(なし)", "output": "XML 文字列", "tools": [], "code": "import urllib.request\nreq = urllib.request.Request('https://example.com/rss', headers={'User-Agent':'YuriOS'})\nprint(urllib.request.urlopen(req, timeout=5).read().decode('utf-8'))"},
    {"id": "node_2", "label": "タイトル抽出", "role": "code", "description": "前 5 件のタイトル/URL を JSON 化", "input": "RSS XML", "output": "JSON 配列", "tools": [], "code": "import sys, json, re\nxml = sys.stdin.read()\nitems = re.findall(r'<item>.*?<title>(.*?)</title>.*?<link>(.*?)</link>.*?</item>', xml, re.S)\nprint(json.dumps([{'title':t,'url':u} for t,u in items[:5]], ensure_ascii=False))"},
    {"id": "node_3", "label": "AI要約", "role": "summarizer", "description": "ニュースリストを日本語要約", "input": "JSON 配列", "output": "Markdown", "tools": [], "system_prompt": "# Role: ...\n# Objective: ...\n# Workflow: ...\n# Output Format: ..."}
  ],
  "edges": [
    {"id": "edge_1", "source": "node_1", "target": "node_2", "description": "RSS XML"},
    {"id": "edge_2", "source": "node_2", "target": "node_3", "description": "ニュース JSON"}
  ]
}
注意: description、input、output、tools は全ノード必須。agent ノードは system_prompt、condition ノードは condition_prompt、code ノードは code フィールドが必須。純粋な JSON のみを出力。""",
    "en": """You are the senior tactical advisor of Yuri OS (Yuri Tactical Operating System).
The user (Supreme Commander) will input a natural language directive. Analyze it and transform it into a Multi-Agent collaborative architecture plan.

Allowed Agent roles and applicable scenarios:
- searcher: information gathering, data acquisition, web queries, scraping
- summarizer: content distillation, summary generation, information compression, analysis
- writer: article writing, content creation, copywriting, text generation
- coder: code writing, debugging, technical implementation, script generation
- formatter: format conversion, layout beautification, Markdown organization, output normalization
- default: general processing, use when none of the above categories clearly apply
- condition: a routing/branching node. MUST be used for any if/else, branching, either-or, or condition-check scenario. It reads upstream output and emits true or false; downstream branches diverge based on the boolean.
- code: **deterministic Python code node — NO LLM call**. Use for HTTP/scraping, DB queries, JSON extract/reshape, string manipulation, API calls, deterministic logic checks — anything that does NOT need "understanding" or "generation". Tens of times faster than an LLM node, near-zero token cost, deterministically reproducible. **Whenever a step is "moving/transforming data" rather than "understanding/producing content", prefer code over agent.**

Available tools (write into each node's `tools` field; condition / code nodes MUST use an empty array):
- "web_search": DuckDuckGo web search — recommended for searcher / summarizer
- "fetch_url_content": fetch and extract text from a URL — recommended for searcher / summarizer / writer
- "execute_python_code": sandboxed Python execution — recommended for coder / formatter

[IMPORTANT INSTRUCTIONS]
1. Node design must follow the Input → Process(Description) → Output black-box philosophy.
2. **Non-condition** nodes MUST include a `system_prompt` field, at least 250 chars, following:
   "# Role: <define its highly professional role>\n# Objective: <clarify its core processing goal>\n# Workflow: <step-by-step description of what it should do>\n# Output Format: <strictly what format it must output, e.g. Markdown/JSON>"
3. Every node MUST include a `tools` field (array of strings). List ONLY the tools the node actually needs — do NOT dump all tools into every node. A writer rarely needs execute_python_code; a summarizer rarely needs web_search. Empty array `[]` means pure LLM.
4. **Any branching scenario MUST use a condition node.** Never fake a branch by drawing two mutually-exclusive edges from an ordinary node. A condition node MUST:
   - have `role: "condition"`
   - have NO `system_prompt`, and instead a **`condition_prompt`** that clearly specifies when to emit "true" and when "false". It must emit ONLY one of those two words.
   - have its two outgoing edges tagged with **`sourceHandle: "true"`** and **`sourceHandle: "false"`** respectively, going to the "if-true" and "if-false" downstream nodes.
   - have `tools: []`.
4.5. **code node (deterministic code) rules**:
   - have `role: "code"`
   - have NO `system_prompt`, and instead a **`code`** field: a complete executable Python script. The script reads upstream input via `import sys; payload = sys.stdin.read()`, and whatever it prints to stdout becomes this node's output. The script runs in the sandbox (no env vars, temp cwd, 8s wallclock).
   - have `tools: []`. description / input / output stay populated for human readability.
   - Typical uses: HTTP fetch (`import urllib.request; print(urllib.request.urlopen(url).read().decode())`), JSON extract (`import json; data = json.loads(payload); print(data['field'])`), DB calls, string joining, arithmetic.
   - NOT for: writing natural-language summaries, copy, semantic decisions — that's the agent's job.
5. Edges (connections) MUST include a `description` field. Edges leaving a condition node MUST additionally include a `sourceHandle` field ("true" or "false").
6. **Cycles are NOT supported.** If the user asks for "retry until ...", "loop ...", "iterate until ...", model it as a single condition node (e.g. "if quality OK -> done, else -> revise"). Do NOT introduce back-edges.
7. If the user provides [CURRENT ARCHITECTURE], this is a modification request. Edit/add/delete on the existing graph; keep unchanged nodes and edges with their original IDs.

You MUST return ONLY valid JSON without any Markdown markup.
The JSON MUST follow this structure (mix code and agent nodes — data plumbing goes to code, understanding/generation goes to agents):
{
  "nodes": [
    {"id": "node_1", "label": "Fetch RSS", "role": "code", "description": "Pull RSS feed", "input": "(none)", "output": "Raw XML string", "tools": [], "code": "import urllib.request\nreq = urllib.request.Request('https://example.com/rss', headers={'User-Agent':'YuriOS'})\nprint(urllib.request.urlopen(req, timeout=5).read().decode('utf-8'))"},
    {"id": "node_2", "label": "Extract Titles", "role": "code", "description": "Pick first 5 title+url pairs as JSON", "input": "RSS XML", "output": "JSON array", "tools": [], "code": "import sys, json, re\nxml = sys.stdin.read()\nitems = re.findall(r'<item>.*?<title>(.*?)</title>.*?<link>(.*?)</link>.*?</item>', xml, re.S)\nprint(json.dumps([{'title':t,'url':u} for t,u in items[:5]]))"},
    {"id": "node_3", "label": "AI Summary", "role": "summarizer", "description": "Summarize news list", "input": "JSON array", "output": "Markdown", "tools": [], "system_prompt": "# Role: ...\n# Objective: ...\n# Workflow: ...\n# Output Format: ..."}
  ],
  "edges": [
    {"id": "edge_1", "source": "node_1", "target": "node_2", "description": "raw XML"},
    {"id": "edge_2", "source": "node_2", "target": "node_3", "description": "5-item JSON"}
  ]
}
Note: description, input, output, tools are required for ALL nodes. Agent nodes require system_prompt; condition nodes require condition_prompt; code nodes require the code field. Output pure JSON only.""",
}

@app.post("/api/commander/architect", response_model=schemas.ArchitectureSchema)
def architect_agents(directive: schemas.CommanderDirective):
    # Reload dotenv here to catch live edits without restarting uvicorn
    load_dotenv(override=True)

    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
    model_name = os.getenv("OPENAI_MODEL", "deepseek-chat")

    if not api_key or api_key == "sk-这里填入你的APIKEY":
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured in .env")

    client = OpenAI(api_key=api_key, base_url=base_url)

    locale = directive.locale if directive.locale in ARCHITECT_SYSTEM_PROMPTS else "zh"
    system_prompt = ARCHITECT_SYSTEM_PROMPTS[locale]

    user_content = directive.prompt
    if directive.current_architecture:
        arch_summary = json.dumps(directive.current_architecture, ensure_ascii=False)
        user_content = f"【当前架构】\n{arch_summary}\n\n【修改指令】\n{directive.prompt}"

    # Force output language regardless of user input language
    if locale == "ja":
        user_content += "\n\n【重要】必ず日本語でJSONの全フィールドを生成してください。label、description、input、output、system_prompt、edgeのdescription、全て日本語で記述してください。"
    elif locale == "en":
        user_content += "\n\nIMPORTANT: Generate ALL JSON fields in English. label, description, input, output, system_prompt, and all edge descriptions MUST be written in English."

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content}
            ],
            response_format={"type": "json_object"},
            temperature=0.7
        )
        
        result_content = response.choices[0].message.content
        if not result_content:
            raise ValueError("Empty response from LLM")
            
        # Clean up possible markdown wrappers
        result_content = result_content.strip()
        if result_content.startswith("```json"):
            result_content = result_content[7:]
        if result_content.startswith("```"):
            result_content = result_content[3:]
        if result_content.endswith("```"):
            result_content = result_content[:-3]
            
        parsed_json = json.loads(result_content.strip())
        return schemas.ArchitectureSchema(**parsed_json)
        
    except Exception as e:
        print(f"LLM Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to architect: {str(e)}")
