import os
import json
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("OPENAI_API_KEY")
base_url = os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
model_name = os.getenv("OPENAI_MODEL", "deepseek-chat")

client = OpenAI(api_key=api_key, base_url=base_url)

system_prompt = """
你是 Yuri OS (尤里战术操作系统) 的高级战术参谋。
用户(最高指挥官)将输入一段自然语言指令，你需要分析该指令，并将其转化为一个多智能体(Multi-Agent)协同工作的架构方案。
你需要将架构拆分为具体的 Agent 节点，以及它们之间的数据/逻辑连接线。

允许的 Agent role 只有: "architect", "coder", "researcher", "database", "default"。

你必须且只能返回一个合法的 JSON 格式，不要包含 Markdown 标记（如 ```json）。
返回的 JSON 必须符合以下结构:
{
  "nodes": [
    {"id": "node_1", "label": "前端开发专家", "role": "coder", "description": "负责编写前端代码"}
  ],
  "edges": [
    {"id": "edge_1", "source": "node_1", "target": "node_2"}
  ]
}
"""

try:
    response = client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "帮我组建一个监控并分析美股行情的战术小队"}
        ],
        response_format={"type": "json_object"}
    )
    print(response.choices[0].message.content)
except Exception as e:
    print(f"Error: {e}")
