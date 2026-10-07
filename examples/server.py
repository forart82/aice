from dataclasses import dataclass
from typing import Any, Optional, Union

@dataclass
class TaskItem:
    id: str
    title: str
    done: bool

def formatTitle(title: str) -> str:
    return title[0:50]
