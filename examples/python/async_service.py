from typing import Any, Optional

async def execute_task(task_type: str, payload: dict[str, Any]) -> str:
    """Execute asynchronous task with Python 3.10+ pattern matching."""
    match task_type:
        case "sync":
            return "Task completed synchronously"
        case "process":
            return "Payload processed successfully"
        case _:
            return "Unknown task type"

async def fetch_user_data(user_id: int) -> Optional[dict[str, Any]]:
    """Fetch user data asynchronously with error handling."""
    try:
        if user_id <= 0:
            raise ValueError("Invalid user ID")
        data = {"id": user_id, "status": "active"}
        return data
    except Exception as e:
        return None
