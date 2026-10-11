<?php

declare(strict_types=1);

namespace App\Enums;

enum OrderStatus: string {
    case Pending = 'pending';
    case Processing = 'processing';
    case Completed = 'completed';
    case Cancelled = 'cancelled';
}

function getOrderStatusLabel(OrderStatus $status): string {
    return match ($status) {
        OrderStatus::Pending => 'Pending Payment',
        OrderStatus::Processing => 'Processing Order',
        OrderStatus::Completed => 'Order Completed',
        OrderStatus::Cancelled => 'Order Cancelled',
    };
}
