from typing import Any
from engine.state import GraphState
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.prebuilt import create_react_agent
from engine.tools import AVAILABLE_TOOLS

def create_facility_node(node_id: str, label: str, description: str, system_prompt: str = "", model: str = "", temperature: float = 0.1, progress_callback=None, llm_config: dict = None):
    def facility_func(state: GraphState) -> GraphState:
        payload = state.get("current_payload", "")
        logs = state.get("logs", [])
        results_by_node = state.get("results_by_node", {})

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
            agent = create_react_agent(llm, tools=AVAILABLE_TOOLS)

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

        if progress_callback:
            progress_callback({"type": "node_done", "node_id": node_id, "label": label, "output": output_text})

        return {"current_payload": output_text, "logs": new_logs, "results_by_node": results_by_node}

    return facility_func


def create_condition_node(node_id: str, label: str, condition_prompt: str = "", progress_callback=None, llm_config: dict = None):
    """
    Condition node: asks LLM to evaluate current payload and return 'true' or 'false'.
    The result is stored in state so conditional_edges can route accordingly.
    """
    def condition_func(state: GraphState) -> GraphState:
        payload = state.get("current_payload", "")
        logs = state.get("logs", [])
        results_by_node = state.get("results_by_node", {})

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
            new_logs = logs + [f"[CONDITION] {label} routed → {branch.upper()}"]
        except Exception as e:
            branch = "false"
            new_logs = logs + [f"[ERROR] {label} condition failed, defaulting to false: {str(e)}"]

        results_by_node[node_id] = f"BRANCH: {branch}"

        if progress_callback:
            progress_callback({"type": "node_done", "node_id": node_id, "label": label, "output": f"BRANCH: {branch}"})

        return {"current_payload": payload, "logs": new_logs, "results_by_node": results_by_node}

    def router(state: GraphState) -> str:
        result = state.get("results_by_node", {}).get(node_id, "BRANCH: false")
        return "true" if "BRANCH: true" in result else "false"

    return condition_func, router
