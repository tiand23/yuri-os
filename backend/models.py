from sqlalchemy import Column, Integer, String, Text, ForeignKey, JSON, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class Workspace(Base):
    __tablename__ = "workspaces"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    description = Column(Text, nullable=True)
    canvas_data = Column(JSON, nullable=True) # 存储 React Flow 的 Nodes 和 Edges
    created_at = Column(DateTime, default=datetime.utcnow)
    
    agents = relationship("AgentConfig", back_populates="workspace", cascade="all, delete-orphan")

class AgentConfig(Base):
    __tablename__ = "agent_configs"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=False)
    label = Column(String, index=True, nullable=False)
    role = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    input = Column(Text, nullable=True)
    output = Column(Text, nullable=True)
    
    # 额外的高级配置可以丢在这里
    config_json = Column(JSON, nullable=True) 
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    workspace = relationship("Workspace", back_populates="agents")

class ExecutionLog(Base):
    __tablename__ = "execution_logs"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=False)
    status = Column(String, default="running") # running, completed, failed
    initial_payload = Column(Text, nullable=True)
    final_payload = Column(Text, nullable=True)
    logs_json = Column(JSON, nullable=True) # Store detailed log stream
    results_by_node = Column(JSON, nullable=True) # Store results per node: {node_id: output_text}
    nodes_snapshot = Column(JSON, nullable=True) # Store node metadata at execution time: [{id, label, role}]
    node_timings = Column(JSON, nullable=True) # {node_id: {started_at, ended_at, duration_ms}} for Gantt visualization
    execution_time_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    workspace = relationship("Workspace")
