from dataclasses import dataclass


@dataclass
class LedgerEntry:
    account: str
    delta: int


def apply_delta(entry: LedgerEntry, base: int = 0) -> int:
    if entry.delta < 0:
        return max(0, base + entry.delta)
    return base + entry.delta
