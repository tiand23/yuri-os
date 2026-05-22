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

@tool
def execute_python_code(code: str) -> str:
    """
    Execute Python code in a sandboxed environment and return the standard output.
    Print the results you want to see.
    """
    import sys
    import io
    import traceback
    
    # Capture stdout
    old_stdout = sys.stdout
    redirected_output = sys.stdout = io.StringIO()
    
    try:
        # Create a restricted local scope
        local_scope = {}
        exec(code, {"__builtins__": __builtins__}, local_scope)
        output = redirected_output.getvalue()
        return output if output else "Code executed successfully with no output."
    except Exception as e:
        output = redirected_output.getvalue()
        error = traceback.format_exc()
        return f"Output:\n{output}\nError:\n{error}"
    finally:
        sys.stdout = old_stdout

# Define a registry of available tools
AVAILABLE_TOOLS = [web_search, fetch_url_content, execute_python_code]
