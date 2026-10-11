from dataclasses import dataclass
from typing import Optional

@dataclass
class InventoryItem:
    """Represents an item in the warehouse inventory."""
    id: int
    name: str
    unit_price: float
    quantity: int = 0
    category: Optional[str] = None

    def total_value(self) -> float:
        """Calculate total value of inventory for this item."""
        return self.unit_price * self.quantity

    def is_in_stock(self) -> bool:
        """Check if item quantity is positive."""
        return self.quantity > 0
