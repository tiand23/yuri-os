import operator
from typing import TypedDict, List, Dict, Any, Annotated


def _last_write_wins(_prev: str, new: str) -> str:
    """Reducer for current_payload.

    Without a reducer LangGraph rejects any concurrent update with INVALID_CONCURRENT_GRAPH_UPDATE.
    Linear chains naturally produce one update per super-step (always returns `new`, equivalent to
    overwrite). Fan-in branches do produce two concurrent updates here — LangGraph folds them
    pairwise via this function, so the final value is whichever the fold order picks.
    That's fine: fan-in *downstream* nodes don't read current_payload anymore — they assemble
    their input from results_by_node[upstream_id] in engine/nodes.py:_assemble_payload.
    """
    return new


# Reducers (LangGraph folds concurrent updates within a super-step via these):
# - dict channels use `operator.or_` so parallel writes from fan-in branches merge by key
#   instead of one overwriting the other. Each node writes a fresh dict containing its own
#   node_id key; the union keeps everyone's contribution.
# - logs use `operator.add` (list concat) so per-branch log lines all survive.
# - current_payload uses last-write-wins (see above); the actual fan-in input plumbing
#   lives in engine/nodes.py.

class GraphState(TypedDict, total=False):
    current_payload: Annotated[str, _last_write_wins]
    logs: Annotated[List[str], operator.add]
    results_by_node: Annotated[Dict[str, str], operator.or_]
    # Per-node timing for Gantt visualization: {node_id: {started_at, ended_at, duration_ms}}
    node_timings: Annotated[Dict[str, Dict[str, Any]], operator.or_]
    # Condition branch decisions: __branch_<node_id> = "true" | "false"
    # Using total=False allows arbitrary extra keys for condition nodes
