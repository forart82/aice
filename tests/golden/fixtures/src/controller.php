<?php

declare(strict_types=1);

class Controller {
    public function index(string $name): string {
        return "hello:" . $name;
    }
}
