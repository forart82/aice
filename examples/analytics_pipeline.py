from dataclasses import dataclass
from typing import Any, Optional, Union

@dataclass
class MetricEntry:
    timestamp: int
    metricName: str
    value: float
    tag: str

@dataclass
class SummaryReport:
    count: int
    totalValue: float
    averageValue: float
    primaryTag: str

def sanitizeTag(rawTag: str) -> str:
    return rawTag[0:16]

def addPoint(points: list[MetricEntry], newPoint: MetricEntry) -> list[MetricEntry]:
    return [*points, newPoint]

def calculateAverage(total: float, count: int) -> float:
    return total / count

def createEntry(time: int, name: str, val: float, rawTag: str) -> MetricEntry:
    cleanTag = sanitizeTag(rawTag)
    return { "timestamp": time, "metricName": name, "value": val, "tag": cleanTag }
