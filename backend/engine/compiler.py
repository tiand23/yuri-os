from typing import Dict, Any, List, Optional
from langgraph.graph import StateGraph, START, END
from engine.state import GraphState
from engine.nodes import create_facility_node, create_condition_node, create_code_node


class CycleDetectedError(ValueError):
    """Raised when the canvas DAG contains a cycle. `cycle` lists the node ids forming the loop."""
    def __init__(self, cycle: List[str]):
        self.cycle = cycle
        path = " → ".join(cycle)
        super().__init__(f"Cycle detected in workflow: {path}. Yuri OS does not support cyclic graphs yet — remove the back-edge or use a Condition node to break the loop.")




def _detect_cycle(node_ids: List[str], adjacency: Dict[str, List[str]]) -> Optional[List[str]]:
    """DFS with 3-color marking. Returns the list of node ids forming a cycle, or None if acyclic."""
    WHITE, GRAY, BLACK = 0, 1, 2
    color: Dict[str, int] = {nid: WHITE for nid in node_ids}
    parent: Dict[str, Optional[str]] = {nid: None for nid in node_ids}

    def dfs(start: str) -> Optional[List[str]]:
        stack = [(start, iter(adjacency.get(start, [])))]
        color[start] = GRAY
        while stack:
            node, it = stack[-1]
            nxt = next(it, None)
            if nxt is None:
                color[node] = BLACK
                stack.pop()
                continue
            if color[nxt] == GRAY:
                # Found a back-edge: reconstruct cycle from nxt up to node via parent chain
                cycle = [nxt]
                cur = node
                while cur is not None and cur != nxt:
                    cycle.append(cur)
                    cur = parent[cur]
                cycle.append(nxt)
                cycle.reverse()
                return cycle
            if color[nxt] == WHITE:
                parent[nxt] = node
                color[nxt] = GRAY
                stack.append((nxt, iter(adjacency.get(nxt, []))))
        return None

    for nid in node_ids:
        if color[nid] == WHITE:
            found = dfs(nid)
            if found:
                return found
    return None


def compile_workflow(canvas_data: Dict[str, Any], progress_callback=None, llm_config: dict = None):
    nodes = canvas_data.get("nodes", [])
    edges = canvas_data.get("edges", [])

    if not nodes:
        raise ValueError("Canvas is empty. No facilities deployed.")

    # Pre-flight: detect cycles BEFORE building the StateGraph, so users get a
    # clear, actionable error instead of a recursion_limit failure 50 invocations later.
    raw_node_ids = [n["id"] for n in nodes]
    raw_node_id_set = set(raw_node_ids)
    pre_adjacency: Dict[str, List[str]] = {nid: [] for nid in raw_node_ids}
    for edge in edges:
        s, t = edge.get("source"), edge.get("target")
        if s in raw_node_id_set and t in raw_node_id_set:
            pre_adjacency[s].append(t)
    cycle = _detect_cycle(raw_node_ids, pre_adjacency)
    if cycle is not None:
        raise CycleDetectedError(cycle)

    # Compute each node's upstream id list. Fan-in nodes (len > 1) use these at runtime
    # (engine/nodes.py) to assemble their input payload from results_by_node[upstream_id]
    # rather than reading current_payload (which is overwrite-semantics and would lose a branch).
    incoming_sources: Dict[str, List[str]] = {nid: [] for nid in raw_node_ids}
    for edge in edges:
        s, t = edge.get("source"), edge.get("target")
        if s in raw_node_id_set and t in raw_node_id_set:
            incoming_sources[t].append(s)

    builder = StateGraph(GraphState)

    node_ids = set()
    condition_node_ids = set()

    for node in nodes:
        nid = node["id"]
        node_type = node.get("type", "agent")
        data = node.get("data", {})

        upstream_ids = incoming_sources.get(nid, [])

        if node_type == "condition":
            label = data.get("label", f"Condition_{nid}")
            condition_prompt = data.get("condition_prompt", "")
            condition_func, _ = create_condition_node(nid, label, condition_prompt, upstream_ids=upstream_ids, progress_callback=progress_callback, llm_config=llm_config)
            builder.add_node(nid, condition_func)
            condition_node_ids.add(nid)
        elif node_type == "code":
            # Deterministic Python-only node — no LLM. Receives upstream payload via stdin,
            # emits stdout as this node's output.
            label = data.get("label", f"Code_{nid}")
            code = data.get("code", "")
            builder.add_node(nid, create_code_node(nid, label, code, upstream_ids=upstream_ids, progress_callback=progress_callback))
        else:
            label = data.get("label", f"Node_{nid}")
            description = data.get("description", "")
            system_prompt = data.get("system_prompt", "")
            model = data.get("model", "")
            temperature = float(data.get("temperature", 0.1))
            tools = data.get("tools")  # None | list[str] — None means all tools (legacy)
            builder.add_node(nid, create_facility_node(nid, label, description, system_prompt, model, temperature, tools=tools, upstream_ids=upstream_ids, progress_callback=progress_callback, llm_config=llm_config))

        node_ids.add(nid)

    # Group edges by source
    edges_by_source: Dict[str, list] = {nid: [] for nid in node_ids}
    incoming_count = {nid: 0 for nid in node_ids}

    for edge in edges:
        source = edge["source"]
        target = edge["target"]
        source_handle = edge.get("sourceHandle", None)  # "true" | "false" | None
        if source in node_ids and target in node_ids:
            edges_by_source[source].append({"target": target, "handle": source_handle})
            incoming_count[target] += 1

    # Wire edges
    for source_id, out_edges in edges_by_source.items():
        if not out_edges:
            continue

        if source_id in condition_node_ids:
            # Build routing map: {"true": target_id, "false": target_id}
            route_map: Dict[str, str] = {}
            for e in out_edges:
                handle = e["handle"] or "true"
                route_map[handle] = e["target"]

            # Fill missing branches with END
            if "true" not in route_map:
                route_map["true"] = END
            if "false" not in route_map:
                route_map["false"] = END

            _, router_func = create_condition_node(
                source_id,
                "",  # label not needed for router
                ""
            )
            builder.add_conditional_edges(source_id, router_func, route_map)
        else:
            for e in out_edges:
                builder.add_edge(source_id, e["target"])

    # START → source nodes (no incoming edges)
    start_nodes = [nid for nid, count in incoming_count.items() if count == 0]
    if not start_nodes and node_ids:
        start_nodes = [list(node_ids)[0]]
    for nid in start_nodes:
        builder.add_edge(START, nid)

    # Sink nodes → END (no outgoing edges, and not a condition node already handled)
    for nid in node_ids:
        if not edges_by_source[nid] and nid not in condition_node_ids:
            builder.add_edge(nid, END)

    return builder.compile()
