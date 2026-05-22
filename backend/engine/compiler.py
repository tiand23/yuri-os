from typing import Dict, Any
from langgraph.graph import StateGraph, START, END
from engine.state import GraphState
from engine.nodes import create_facility_node, create_condition_node

def compile_workflow(canvas_data: Dict[str, Any], progress_callback=None, llm_config: dict = None):
    nodes = canvas_data.get("nodes", [])
    edges = canvas_data.get("edges", [])

    if not nodes:
        raise ValueError("Canvas is empty. No facilities deployed.")

    builder = StateGraph(GraphState)

    node_ids = set()
    condition_node_ids = set()

    for node in nodes:
        nid = node["id"]
        node_type = node.get("type", "agent")
        data = node.get("data", {})

        if node_type == "condition":
            label = data.get("label", f"Condition_{nid}")
            condition_prompt = data.get("condition_prompt", "")
            condition_func, _ = create_condition_node(nid, label, condition_prompt, progress_callback=progress_callback, llm_config=llm_config)
            builder.add_node(nid, condition_func)
            condition_node_ids.add(nid)
        else:
            label = data.get("label", f"Node_{nid}")
            description = data.get("description", "")
            system_prompt = data.get("system_prompt", "")
            model = data.get("model", "")
            temperature = float(data.get("temperature", 0.1))
            builder.add_node(nid, create_facility_node(nid, label, description, system_prompt, model, temperature, progress_callback=progress_callback, llm_config=llm_config))

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
