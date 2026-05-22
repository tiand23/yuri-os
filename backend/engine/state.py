from typing import TypedDict, List, Dict, Any

class GraphState(TypedDict, total=False):
    current_payload: str
    logs: List[str]
    results_by_node: Dict[str, str]
    # Condition branch decisions: __branch_<node_id> = "true" | "false"
    # Using total=False allows arbitrary extra keys for condition nodes
