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
import time

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
            "results_by_node": {}
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
                    "results_by_node": {}
                }
                final_state = app_graph.invoke(initial_state, config={"recursion_limit": 50})
                asyncio.run_coroutine_threadsafe(
                    queue.put({
                        "type": "done",
                        "final_payload": final_state.get("current_payload", ""),
                        "logs": final_state.get("logs", []),
                        "results_by_node": final_state.get("results_by_node", {}),
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

【重要指示】
1. 节点设计必须具体，且完全按照输入(Input)-处理(Description)-输出(Output) 的极简黑盒理念设计。
2. 每个节点必须包含 system_prompt 字段：为该 Agent 编写一段极具专业性、结构化的 System Prompt。
   绝不允许写成几句干瘪的简述。你必须遵循以下结构来编写这个字段：
   "# Role: <定义其极其专业的角色>\n# Objective: <明确它的核心处理目标>\n# Workflow: <按步骤描述它应该怎么做>\n# Output Format: <它必须严格输出什么格式的数据，例如Markdown/JSON>"
   请确保 system_prompt 字段的字数不少于 250 字，规则越详尽、边界条件越清晰越好。这是该 Agent 运行时遵循的唯一法则。
3. 连线 (edges) 必须包含 description 字段，用简短的话描述这条线上传递了什么数据。
4. 如果用户提供了【当前架构】，说明这是一次修改指令。你必须在现有架构基础上进行增删改，而不是重新生成全新架构。保留用户没有提到要修改的节点和连线，id 保持不变。

你必须且只能返回一个合法的 JSON 格式，不要包含 Markdown 标记（如 ```json）。
返回的 JSON 必须符合以下结构:
{
  "nodes": [
    {"id": "node_1", "label": "逻辑装配中心", "role": "coder", "description": "负责编写前端代码", "input": "自然语言的功能需求", "output": "无报错的源代码文件", "system_prompt": "# Role: 资深前端架构师\n# Objective: 接收用户的功能需求描述，输出可直接运行的 React 组件代码...\n# Workflow: 1. 分析需求... 2. 编写代码...\n# Output Format: 只输出纯代码，不附带任何说明。"}
  ],
  "edges": [
    {"id": "edge_1", "source": "node_1", "target": "node_2", "description": "将编译好的源代码传递给格式化器进行整理"}
  ]
}
注意：description、input、output、system_prompt 字段缺一不可。绝不允许输出任何 Markdown 格式。直接输出纯 JSON 字符串。""",
    "ja": """あなたは Yuri OS（ユーリ戦術オペレーティングシステム）の上級戦術参謀です。
ユーザー（最高司令官）が自然言語の指示を入力します。その指示を分析し、マルチエージェント（Multi-Agent）協調作業のアーキテクチャ計画に変換してください。
アーキテクチャを具体的なAgentノードとそれらの間のデータ/ロジック接続線に分解してください。

許可されたAgentのロールと適用シナリオ:
- searcher: 情報収集、データ取得、ウェブクエリ、スクレイピング
- summarizer: コンテンツ抽出、要約生成、情報圧縮、分析
- writer: 記事執筆、コンテンツ作成、コピーライティング、テキスト生成
- coder: コード作成、デバッグ、技術実装、スクリプト生成
- formatter: フォーマット変換、レイアウト整形、Markdown整理、出力規範化
- default: 汎用処理、上記のカテゴリに明確に該当しない場合に使用

【重要指示】
1. ノード設計は具体的であり、入力(Input)-処理(Description)-出力(Output)の極簡ブラックボックス理念に完全に従ってください。
2. 各ノードには system_prompt フィールドが必須です：このAgentのための高度に専門的で構造化されたSystem Promptを記述してください。
   必ず以下の構造に従ってください: "# Role: <非常に専門的な役割の定義>\n# Objective: <コア処理目標の明確化>\n# Workflow: <実行すべき処理のステップ別記述>\n# Output Format: <厳密な出力フォーマット、例:Markdown/JSON>"
   system_promptは250文字以上必須で、ルールと境界条件が詳細であるほど良い。これはこのAgentの実行時に従う唯一の法則です。
3. 接続線（edges）には description フィールドが必須です。この接続線で転送されるデータを簡潔に説明してください。
4. ユーザーが【現在のアーキテクチャ】を提供した場合、これは修正リクエストです。指示に基づいて既存のアーキテクチャを変更（追加/削除/編集）してください。変更されていないノードと接続線を保持し、IDを変更しないでください。

必ずMarkdownマークアップなし（```jsonなし）の合法なJSONのみを返してください。
返すJSONは以下の構造に従ってください:
{
  "nodes": [
    {"id": "node_1", "label": "ロジックアセンブリセンター", "role": "coder", "description": "フロントエンドコードを作成", "input": "自然言語の機能要件", "output": "エラーなしのソースコードファイル", "system_prompt": "# Role: シニアフロントエンドアーキテクト\n# Objective: ...\n# Workflow: 1. 要件を分析... 2. コードを作成...\n# Output Format: 純粋なコードのみ出力、説明なし。"}
  ],
  "edges": [
    {"id": "edge_1", "source": "node_1", "target": "node_2", "description": "コンパイル済みソースコードをフォーマッターに渡す"}
  ]
}
注意: description、input、output、system_promptフィールドは全て必須です。Markdownフォーマットを一切出力しないでください。純粋なJSON文字列のみを出力してください。""",
    "en": """You are the senior tactical advisor of Yuri OS (Yuri Tactical Operating System).
The user (Supreme Commander) will input a natural language directive. Analyze it and transform it into a Multi-Agent collaborative architecture plan.
Break the architecture into specific Agent nodes and the data/logic connections between them.

Allowed Agent roles and applicable scenarios:
- searcher: information gathering, data acquisition, web queries, scraping
- summarizer: content distillation, summary generation, information compression, analysis
- writer: article writing, content creation, copywriting, text generation
- coder: code writing, debugging, technical implementation, script generation
- formatter: format conversion, layout beautification, Markdown organization, output normalization
- default: general processing, use when none of the above categories clearly apply

[IMPORTANT INSTRUCTIONS]
1. Node design must be specific and follow the extreme minimalist black-box philosophy of Input-Process-Output.
2. Each node MUST include a system_prompt field: write a highly professional, structured System Prompt for this Agent.
   Never write it as a few dry sentences. You MUST follow this structure:
   "# Role: <define its highly professional role>\n# Objective: <clarify its core processing goal>\n# Workflow: <step-by-step description of what it should do>\n# Output Format: <strictly what format it must output, e.g. Markdown/JSON>"
   Ensure system_prompt is at least 250 characters. The more detailed the rules and edge cases, the better. This is the only law this Agent follows at runtime.
3. Edges (connections) MUST include a description field briefly describing what data flows through this connection.
4. If the user provides [CURRENT ARCHITECTURE], this is a modification request. Make additions/deletions/edits to the existing architecture based on the directive. Keep unchanged nodes and edges with their original IDs.

You MUST return ONLY valid JSON without any Markdown markup (no ```json).
The JSON MUST follow this structure:
{
  "nodes": [
    {"id": "node_1", "label": "Logic Assembly Center", "role": "coder", "description": "Writes frontend code", "input": "Natural language feature requirements", "output": "Error-free source code files", "system_prompt": "# Role: Senior Frontend Architect\n# Objective: Receive feature requirement descriptions and output directly runnable React component code...\n# Workflow: 1. Analyze requirements... 2. Write code...\n# Output Format: Output pure code only, no explanations."}
  ],
  "edges": [
    {"id": "edge_1", "source": "node_1", "target": "node_2", "description": "Pass compiled source code to formatter for cleanup"}
  ]
}
Note: description, input, output, system_prompt fields are all mandatory. Never output any Markdown format. Output pure JSON string only.""",
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
