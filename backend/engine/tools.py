from langchain_core.tools import tool
import urllib.request
import json

@tool
def web_search(query: str) -> str:
    """
    Search the web for information. Use this when you need current information or facts.
    """
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=5))
            if not results:
                return "No results found."
            return "\n".join([f"Title: {r['title']}\nSnippet: {r['body']}\nURL: {r['href']}\n" for r in results])
    except Exception as e:
        return f"Error performing search: {str(e)}"

@tool
def fetch_url_content(url: str) -> str:
    """
    Fetch the text content of a given URL.
    """
    try:
        req = urllib.request.Request(
            url, 
            data=None, 
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            html = response.read().decode('utf-8')
            # Extract basic text (very naive, usually bs4 is better)
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html, 'html.parser')
            text = soup.get_text(separator=' ', strip=True)
            return text[:5000] + "...\n(Truncated)" if len(text) > 5000 else text
    except Exception as e:
        return f"Failed to fetch URL: {str(e)}"

# Hard limits for the Python sandbox subprocess.
# - WALLCLOCK is enforced by subprocess.run(timeout=...) and is the most reliable cap.
# - CPU/MEM/FSIZE are enforced via setrlimit on Unix; on platforms without `resource` they
#   silently degrade (the wallclock + isolated env still hold).
_SANDBOX_WALLCLOCK_SEC = 8
_SANDBOX_CPU_SEC = 5
_SANDBOX_MEM_BYTES = 256 * 1024 * 1024   # 256 MiB
_SANDBOX_FSIZE_BYTES = 4 * 1024 * 1024   # 4 MiB max output file
_SANDBOX_OUTPUT_CHARS = 8000             # truncate captured stdout/stderr to this many chars


def run_sandboxed_python(code: str, stdin_payload: str = "") -> str:
    """Run Python code in an isolated subprocess and return stdout (or formatted error).

    Shared by both the `execute_python_code` LLM-callable tool AND the Code Node engine
    (engine/nodes.py:create_code_node) so the security guarantees apply uniformly.

    Limits enforced:
      - 8 s wallclock timeout (subprocess.run timeout)
      - 5 s CPU time, 256 MiB memory, 4 MiB output file (Unix setrlimit)
      - clean environment variables (cannot read OPENAI_API_KEY etc)
      - isolated temp working directory (cannot read project files via relative paths)

    Network access is NOT blocked — Code Nodes commonly need to call HTTP APIs or DBs.

    `stdin_payload` is fed to the subprocess's stdin. Code Node templates rely on this:
    user code reads `payload = sys.stdin.read()` to receive the upstream agent's output.
    For the LLM tool case (no upstream), it defaults to empty.
    """
    import subprocess
    import sys
    import tempfile
    import shutil

    preexec = None
    try:
        import resource

        def _apply_rlimits():
            resource.setrlimit(resource.RLIMIT_CPU, (_SANDBOX_CPU_SEC, _SANDBOX_CPU_SEC))
            try:
                resource.setrlimit(resource.RLIMIT_AS, (_SANDBOX_MEM_BYTES, _SANDBOX_MEM_BYTES))
            except (ValueError, OSError):
                pass
            try:
                resource.setrlimit(resource.RLIMIT_FSIZE, (_SANDBOX_FSIZE_BYTES, _SANDBOX_FSIZE_BYTES))
            except (ValueError, OSError):
                pass
            try:
                resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
            except (ValueError, AttributeError, OSError):
                pass

        preexec = _apply_rlimits
    except ImportError:
        pass

    workdir = tempfile.mkdtemp(prefix="yurios_sbx_")
    try:
        clean_env = {"PATH": "/usr/bin:/bin:/usr/local/bin", "LANG": "C.UTF-8"}

        try:
            result = subprocess.run(
                [sys.executable, "-I", "-c", code],
                cwd=workdir,
                env=clean_env,
                input=stdin_payload,
                capture_output=True,
                text=True,
                timeout=_SANDBOX_WALLCLOCK_SEC,
                preexec_fn=preexec,
            )
        except subprocess.TimeoutExpired:
            return f"Error: execution exceeded {_SANDBOX_WALLCLOCK_SEC}s wallclock limit and was killed."

        out = (result.stdout or "")[:_SANDBOX_OUTPUT_CHARS]
        err = (result.stderr or "")[:_SANDBOX_OUTPUT_CHARS]

        if result.returncode != 0:
            return f"Output:\n{out}\nError (exit {result.returncode}):\n{err}"
        if not out and err:
            return f"Output:\n(empty)\nStderr:\n{err}"
        return out if out else "Code executed successfully with no output."
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


@tool
def execute_python_code(code: str) -> str:
    """
    Execute Python code in a sandboxed subprocess and return its stdout.
    Print the results you want to see. Network access is NOT blocked — agents may
    legitimately need to call APIs. The sandbox isolates env vars, working directory,
    CPU time, memory, and wallclock.
    """
    return run_sandboxed_python(code, stdin_payload="")

# Tool registry keyed by name — lets nodes opt-in to specific tools via node.data.tools.
# Frontend reads TOOL_METADATA to render checkboxes; backend uses TOOL_REGISTRY to filter at runtime.
TOOL_REGISTRY = {
    "web_search": web_search,
    "fetch_url_content": fetch_url_content,
    "execute_python_code": execute_python_code,
}

# Public metadata describing each tool — kept here so it stays alongside the implementation.
# Note: tools.py is the source of truth; if you add a tool, also update this dict.
TOOL_METADATA = [
    {
        "name": "web_search",
        "label": "Web Search",
        "description": "Search the web via DuckDuckGo for current information.",
        "recommended_for": ["searcher", "summarizer"],
    },
    {
        "name": "fetch_url_content",
        "label": "Fetch URL",
        "description": "Download and extract text content from a URL.",
        "recommended_for": ["searcher", "summarizer", "writer"],
    },
    {
        "name": "execute_python_code",
        "label": "Python Sandbox",
        "description": "Execute Python code (sandboxed) and return stdout.",
        "recommended_for": ["coder", "formatter"],
    },
]


def select_tools(names: list | None) -> list:
    """Filter the global tool registry by a list of names.
    None or empty list → all tools (legacy behavior). Unknown names are silently skipped."""
    if not names:
        return list(TOOL_REGISTRY.values())
    return [TOOL_REGISTRY[n] for n in names if n in TOOL_REGISTRY]


# Backwards-compatible global — keep until all callers migrate to select_tools().
AVAILABLE_TOOLS = list(TOOL_REGISTRY.values())
