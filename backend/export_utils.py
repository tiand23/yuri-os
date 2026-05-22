import io
import json
import zipfile
import os

def generate_workspace_export_zip(workspace_data: dict) -> io.BytesIO:
    """
    Generate a standalone zip file containing a complete runnable FastAPI backend
    that executes the given workspace canvas_data using LangGraph.
    """
    zip_buffer = io.BytesIO()
    
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        # 1. canvas_data.json
        zip_file.writestr("canvas_data.json", json.dumps(workspace_data, ensure_ascii=False, indent=2))
        
        # 2. requirements.txt
        reqs = (
            "fastapi\n"
            "uvicorn\n"
            "pydantic\n"
            "langchain\n"
            "langchain-openai\n"
            "langgraph\n"
            "duckduckgo-search\n"
            "python-dotenv\n"
            "beautifulsoup4\n"
        )
        zip_file.writestr("requirements.txt", reqs)
        
        # 3. Dockerfile
        dockerfile = (
            "FROM python:3.11-slim\n"
            "WORKDIR /app\n"
            "COPY requirements.txt .\n"
            "RUN pip install --no-cache-dir -r requirements.txt\n"
            "COPY . .\n"
            "EXPOSE 8000\n"
            "CMD [\"uvicorn\", \"main:app\", \"--host\", \"0.0.0.0\", \"--port\", \"8000\"]\n"
        )
        zip_file.writestr("Dockerfile", dockerfile)
        
        # 4. .env.example
        zip_file.writestr(".env.example", "OPENAI_API_KEY=sk-your-key-here\nOPENAI_BASE_URL=https://api.deepseek.com/v1\nOPENAI_MODEL=deepseek-chat\n")
        
        # 5. main.py (Standalone Runner)
        main_py = """import json
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

from engine.compiler import compile_workflow

load_dotenv()
app = FastAPI(title="Yuri OS - Exported Agent Service")

with open("canvas_data.json", "r", encoding="utf-8") as f:
    CANVAS_DATA = json.load(f)

GRAPH = compile_workflow(CANVAS_DATA)

class ExecuteRequest(BaseModel):
    payload: str

@app.post("/execute")
def execute_workflow(request: ExecuteRequest):
    try:
        initial_state = {
            "current_payload": request.payload,
            "logs": ["Agent Service Started."],
            "results_by_node": {}
        }
        final_state = GRAPH.invoke(initial_state, config={"recursion_limit": 50})
        return {
            "status": "success",
            "final_payload": final_state.get("current_payload", ""),
            "logs": final_state.get("logs", []),
            "results_by_node": final_state.get("results_by_node", {})
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
"""
        zip_file.writestr("main.py", main_py)
        
        # 6. Copy engine directory
        engine_dir = os.path.join(os.path.dirname(__file__), "engine")
        for root, _, files in os.walk(engine_dir):
            if "__pycache__" in root:
                continue
            for file in files:
                if file.endswith(".py"):
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, os.path.dirname(__file__))
                    with open(file_path, "r", encoding="utf-8") as f:
                        zip_file.writestr(rel_path, f.read())

    zip_buffer.seek(0)
    return zip_buffer
