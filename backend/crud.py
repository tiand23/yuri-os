from sqlalchemy.orm import Session
import models, schemas

# Workspace CRUD
def get_workspace(db: Session, workspace_id: int):
    return db.query(models.Workspace).filter(models.Workspace.id == workspace_id).first()

def get_workspaces(db: Session, skip: int = 0, limit: int = 100):
    return db.query(models.Workspace).offset(skip).limit(limit).all()

def create_workspace(db: Session, workspace: schemas.WorkspaceCreate):
    db_workspace = models.Workspace(**workspace.model_dump())
    db.add(db_workspace)
    db.commit()
    db.refresh(db_workspace)
    return db_workspace

def update_workspace_canvas(db: Session, workspace_id: int, canvas_data: dict):
    db_workspace = get_workspace(db, workspace_id)
    if db_workspace:
        db_workspace.canvas_data = canvas_data
        db.commit()
        db.refresh(db_workspace)
    return db_workspace

def delete_workspace(db: Session, workspace_id: int):
    db_workspace = get_workspace(db, workspace_id)
    if db_workspace:
        db.delete(db_workspace)
        db.commit()
    return db_workspace

# AgentConfig CRUD
def get_agent_config(db: Session, agent_id: int):
    return db.query(models.AgentConfig).filter(models.AgentConfig.id == agent_id).first()

def get_agent_configs_by_workspace(db: Session, workspace_id: int, skip: int = 0, limit: int = 100):
    return db.query(models.AgentConfig).filter(models.AgentConfig.workspace_id == workspace_id).offset(skip).limit(limit).all()

def create_agent_config(db: Session, agent_config: schemas.AgentConfigCreate):
    db_agent_config = models.AgentConfig(**agent_config.model_dump())
    db.add(db_agent_config)
    db.commit()
    db.refresh(db_agent_config)
    return db_agent_config

def update_agent_config(db: Session, agent_id: int, updates: dict):
    db_agent = get_agent_config(db, agent_id)
    if db_agent:
        for key, value in updates.items():
            setattr(db_agent, key, value)
        db.commit()
        db.refresh(db_agent)
    return db_agent

def delete_agent_config(db: Session, agent_id: int):
    db_agent = get_agent_config(db, agent_id)
    if db_agent:
        db.delete(db_agent)
        db.commit()
    return db_agent

# Execution Log CRUD
def create_execution_log(db: Session, execution_log: schemas.ExecutionLogCreate):
    db_log = models.ExecutionLog(**execution_log.model_dump())
    db.add(db_log)
    db.commit()
    db.refresh(db_log)
    return db_log

def update_execution_log(db: Session, log_id: int, updates: dict):
    db_log = db.query(models.ExecutionLog).filter(models.ExecutionLog.id == log_id).first()
    if db_log:
        for key, value in updates.items():
            setattr(db_log, key, value)
        db.commit()
        db.refresh(db_log)
    return db_log

def get_execution_logs(db: Session, workspace_id: int, skip: int = 0, limit: int = 100):
    return db.query(models.ExecutionLog).filter(models.ExecutionLog.workspace_id == workspace_id).order_by(models.ExecutionLog.created_at.desc()).offset(skip).limit(limit).all()
