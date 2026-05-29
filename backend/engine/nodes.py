import time
from typing import Any, Dict, List, Optional
from engine.state import GraphState
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.prebuilt import create_react_agent
from engine.tools import select_tools, run_sandboxed_python

def _assemble_payload(state: GraphState, upstream_ids: Optional[List[str]]) -> str:
    """Pick the right input payload for this node.

    Single-upstream / source nodes read `current_payload` — the linear baton.
    Fan-in nodes (len(upstream_ids) > 1) instead pull each upstream's output from
    results_by_node and concatenate them with a delimiter. Reading current_payload
    in a fan-in case would only see whichever branch happened to commit last.
    """
    if upstream_ids and len(upstream_ids) > 1:
        results = state.get("results_by_node", {}) or {}
        parts = []
        for uid in upstream_ids:
            up_out = results.get(uid, "")
            parts.append(f"[from {uid}]\n{up_out}")
        return "\n\n---\n\n".join(parts)
    return state.get("current_payload", "")


def create_facility_node(node_id: str, label: str, description: str, system_prompt: str = "", model: str = "", temperature: float = 0.1, tools: Optional[List[str]] = None, upstream_ids: Optional[List[str]] = None, progress_callback=None, llm_config: dict = None):
    def facility_func(state: GraphState) -> GraphState:
        payload = _assemble_payload(state, upstream_ids)
        # Reducers fold dict updates from parallel siblings, but for the *baseline* we still
        # want this node's contribution to be just {node_id: output} (not "previous full dict + own").
        # Each task only returns its own delta; the reducer at channel level handles the union.
        logs: List[str] = []
        results_by_node: Dict[str, str] = {}
        node_timings: Dict[str, Dict[str, Any]] = {}

        started_at_ms = int(time.time() * 1000)
        if progress_callback:
            progress_callback({"type": "node_start", "node_id": node_id, "label": label})

        try:
            import os
            cfg = llm_config or {}
            model_name = cfg.get("model_id") or model or os.getenv("OPENAI_MODEL", "deepseek-chat")
            base_url = cfg.get("base_url") or os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
            api_key = cfg.get("api_key") or os.getenv("OPENAI_API_KEY")
            temp = cfg.get("temperature") if cfg.get("temperature") is not None else temperature
            
            llm = ChatOpenAI(model=model_name, base_url=base_url, temperature=temp, api_key=api_key)
            agent = create_react_agent(llm, tools=select_tools(tools))

            if system_prompt:
                system_content = system_prompt
            else:
                system_content = (
                    f"You are a specialized agent facility named '{label}'.\n"
                    f"Your core instruction is: {description}\n"
                    f"Process the input payload according to your instruction. Use tools if necessary. Return only the raw output."
                )

            agent_state = {
                "messages": [
                    SystemMessage(content=system_content),
                    HumanMessage(content=f"INPUT PAYLOAD:\n{payload}")
                ]
            }

            response = agent.invoke(agent_state)
            output_text = str(response["messages"][-1].content)
            new_logs = logs + [f"[SUCCESS] {label} processed data."]
        except Exception as e:
            output_text = f"Error in {label}: {str(e)}"
            new_logs = logs + [f"[ERROR] {label} failed: {str(e)}"]

        results_by_node[node_id] = output_text

        ended_at_ms = int(time.time() * 1000)
        node_timings[node_id] = {
            "started_at": started_at_ms,
            "ended_at": ended_at_ms,
            "duration_ms": ended_at_ms - started_at_ms,
        }

        if progress_callback:
            progress_callback({
                "type": "node_done",
                "node_id": node_id,
                "label": label,
                "output": output_text,
                "duration_ms": ended_at_ms - started_at_ms,
            })

        return {
            "current_payload": output_text,
            "logs": new_logs,
            "results_by_node": results_by_node,
            "node_timings": node_timings,
        }

    return facility_func


def create_condition_node(node_id: str, label: str, condition_prompt: str = "", upstream_ids: Optional[List[str]] = None, progress_callback=None, llm_config: dict = None):
    """
    Condition node: asks LLM to evaluate input payload and return 'true' or 'false'.
    The result is stored in state so conditional_edges can route accordingly.
    Same fan-in handling as facility_func — multiple upstreams get joined from results_by_node.
    """
    def condition_func(state: GraphState) -> GraphState:
        payload = _assemble_payload(state, upstream_ids)
        # delta-only — reducers at channel level handle the merge with sibling branches
        results_by_node: Dict[str, str] = {}
        node_timings: Dict[str, Dict[str, Any]] = {}

        started_at_ms = int(time.time() * 1000)
        if progress_callback:
            progress_callback({"type": "node_start", "node_id": node_id, "label": label})

        try:
            import os
            cfg = llm_config or {}
            model_name = cfg.get("model_id") or os.getenv("OPENAI_MODEL", "deepseek-chat")
            base_url = cfg.get("base_url") or os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
            api_key = cfg.get("api_key") or os.getenv("OPENAI_API_KEY")
            llm = ChatOpenAI(model=model_name, base_url=base_url, temperature=0, api_key=api_key)

            system_content = condition_prompt if condition_prompt else (
                f"You are a routing condition judge named '{label}'.\n"
                "Evaluate the input payload and respond with ONLY the single word 'true' or 'false'.\n"
                "No explanation. No punctuation. Just 'true' or 'false'."
            )

            response = llm.invoke([SystemMessage(content=system_content), HumanMessage(content=f"INPUT PAYLOAD:\n{payload}")])
            decision = str(response.content).strip().lower()
            branch = "true" if "true" in decision else "false"
            new_logs = [f"[CONDITION] {label} routed → {branch.upper()}"]
        except Exception as e:
            branch = "false"
            new_logs = [f"[ERROR] {label} condition failed, defaulting to false: {str(e)}"]

        results_by_node[node_id] = f"BRANCH: {branch}"

        ended_at_ms = int(time.time() * 1000)
        node_timings[node_id] = {
            "started_at": started_at_ms,
            "ended_at": ended_at_ms,
            "duration_ms": ended_at_ms - started_at_ms,
        }

        if progress_callback:
            progress_callback({
                "type": "node_done",
                "node_id": node_id,
                "label": label,
                "output": f"BRANCH: {branch}",
                "duration_ms": ended_at_ms - started_at_ms,
            })

        return {
            "current_payload": payload,
            "logs": new_logs,
            "results_by_node": results_by_node,
            "node_timings": node_timings,
        }

    def router(state: GraphState) -> str:
        result = state.get("results_by_node", {}).get(node_id, "BRANCH: false")
        return "true" if "BRANCH: true" in result else "false"

    return condition_func, router


def create_code_node(node_id: str, label: str, code: str, upstream_ids: Optional[List[str]] = None, progress_callback=None):
    """A deterministic Python-code node — NO LLM call.

    Use this for HTTP fetches, DB queries, JSON reshaping, deterministic logic — anything
    where invoking an LLM is wasteful or unreliable. The upstream payload is piped to the
    code as stdin; whatever the code prints to stdout becomes this node's output.

    Same sandbox as the `execute_python_code` tool (engine/tools.py:run_sandboxed_python):
    isolated env, tempdir cwd, CPU/mem/wallclock limits.
    """
    def code_func(state: GraphState) -> GraphState:
        payload = _assemble_payload(state, upstream_ids)
        results_by_node: Dict[str, str] = {}
        node_timings: Dict[str, Dict[str, Any]] = {}

        started_at_ms = int(time.time() * 1000)
        if progress_callback:
            progress_callback({"type": "node_start", "node_id": node_id, "label": label})

        try:
            if not code or not code.strip():
                output_text = "Error: code node has empty code field."
                new_logs = [f"[ERROR] {label}: empty code"]
            else:
                output_text = run_sandboxed_python(code, stdin_payload=payload)
                # Heuristic — sandbox returns "Output:\n...\nError (exit N):\n..." on failure,
                # surface that as a node-level error so logs page renders it red.
                if output_text.startswith("Error:") or "Error (exit " in output_text.split("\n", 3)[0:4][-1]:
                    new_logs = [f"[ERROR] {label} sandbox returned non-zero"]
                else:
                    new_logs = [f"[SUCCESS] {label} executed code ({len(output_text)} bytes out)"]
        except Exception as e:
            output_text = f"Error in {label}: {str(e)}"
            new_logs = [f"[ERROR] {label} failed: {str(e)}"]

        results_by_node[node_id] = output_text

        ended_at_ms = int(time.time() * 1000)
        node_timings[node_id] = {
            "started_at": started_at_ms,
            "ended_at": ended_at_ms,
            "duration_ms": ended_at_ms - started_at_ms,
        }

        if progress_callback:
            progress_callback({
                "type": "node_done",
                "node_id": node_id,
                "label": label,
                "output": output_text,
                "duration_ms": ended_at_ms - started_at_ms,
            })

        return {
            "current_payload": output_text,
            "logs": new_logs,
            "results_by_node": results_by_node,
            "node_timings": node_timings,
        }

    return code_func
