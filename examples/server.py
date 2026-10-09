from typing import Any, Optional, Union, TypedDict

class HealthResponse(TypedDict):
    status: str
    uptime: int
    version: str

class Config(TypedDict):
    host: str
    port: int
    debug: bool

def checkStatus(healthy: bool) -> str:
    if healthy:
        return "HEALTHY"
    else:
        return "DEGRADED"

def getSystemHealth(uptimeSeconds: int) -> HealthResponse:
    statusText = checkStatus((uptimeSeconds > 0))
    res = {"status": statusText, "uptime": uptimeSeconds, "version": "2.0.0"}
    return res
