import os
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.prebuilt import create_react_agent
from engine.tools import AVAILABLE_TOOLS

def test():
    # Load env from .env if needed
    from dotenv import load_dotenv
    load_dotenv()
    
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
    model_name = os.getenv("OPENAI_MODEL", "deepseek-chat")
    
    llm = ChatOpenAI(model=model_name, base_url=base_url, temperature=0.1, api_key=api_key)
    
    agent = create_react_agent(llm, tools=AVAILABLE_TOOLS)
    
    response = agent.invoke({"messages": [
        SystemMessage(content="You are a helpful assistant. Use tools if necessary."),
        HumanMessage(content="What is the current time? Can you run some python code to tell me the 10th fibonacci number?")
    ]})
    
    for msg in response["messages"]:
        print(f"{type(msg).__name__}: {msg.content}")

if __name__ == "__main__":
    test()
