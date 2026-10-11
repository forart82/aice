<?php

declare(strict_types=1);

namespace App\Repositories;

use App\Models\User;

interface UserRepositoryInterface {
    public function findById(int $id): ?User;
    public function save(User $user): bool;
    public function delete(int $id): void;
}

class UserRepository implements UserRepositoryInterface {
    /**
     * In-memory storage for user entities.
     */
    private array $users = [];

    public function findById(int $id): ?User {
        if (isset($this->users[$id])) {
            return $this->users[$id];
        }
        return null;
    }

    public function save(User $user): bool {
        $this->users[$user->id] = $user;
        return true;
    }

    public function delete(int $id): void {
        unset($this->users[$id]);
    }
}
