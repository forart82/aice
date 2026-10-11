<?php

declare(strict_types=1);

namespace App\Services;

use App\Repositories\UserRepository;
use Exception;

class PaymentService {
    public function __construct(
        private UserRepository $userRepository,
        public readonly float $processingFee = 1.5,
    ) {}

    public function process(int $userId, float $amount, string $method): bool {
        if ($amount <= 0.0) {
            throw new Exception('Invalid payment amount');
        }

        $user = $this->userRepository->findById($userId);
        if ($user === null) {
            throw new Exception('User not found');
        }

        $fee = match ($method) {
            'card' => $amount * 0.03,
            'bank' => 0.5,
            default => $this->processingFee,
        };

        $total = $amount + $fee;
        return $total > 0.0;
    }
}
