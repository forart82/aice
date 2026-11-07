/**
 * Snake Core Game Engine.
 * High-performance 2D grid-based arcade snake engine.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Velocity {
  dx: number;
  dy: number;
}

export interface SnakeSegment {
  position: Point;
  age: number;
}

export type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

export interface GameConfig {
  gridWidth: number;
  gridHeight: number;
  initialSpeed: number;
  speedIncrement: number;
  foodScoreValue: number;
  goldenFoodBonus: number;
}

export interface EngineStats {
  score: number;
  highScore: number;
  applesEaten: number;
  movesCount: number;
  aliveTimeSeconds: number;
}

/**
 * Main game simulation engine.
 */
export class Engine {
  public width: number;
  public height: number;
  public score: number = 0;
  public highScore: number = 0;
  public alive: boolean = true;
  public paused: boolean = false;
  public head: Point;
  public segments: Point[] = [];
  public food: Point;
  public goldenFood: Point | null = null;
  public currentDirection: Direction = "RIGHT";
  public nextDirection: Direction = "RIGHT";
  public movesCount: number = 0;
  public applesEaten: number = 0;

  constructor(width: number = 30, height: number = 20) {
    this.width = width;
    this.height = height;
    this.head = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
    this.segments = [
      { x: this.head.x - 1, y: this.head.y },
      { x: this.head.x - 2, y: this.head.y },
    ];
    this.food = this.spawnFood();
  }

  public step(): boolean {
    if (!this.alive || this.paused) {
      return false;
    }

    this.currentDirection = this.nextDirection;
    const nextHead = this.getNextHeadPosition();

    if (this.checkWallCollision(nextHead) || this.checkSelfCollision(nextHead)) {
      this.alive = false;
      return false;
    }

    this.segments.unshift({ x: this.head.x, y: this.head.y });
    this.head = nextHead;
    this.movesCount += 1;

    if (this.head.x === this.food.x && this.head.y === this.food.y) {
      this.score += 10;
      this.applesEaten += 1;
      if (this.score > this.highScore) {
        this.highScore = this.score;
      }
      this.food = this.spawnFood();
    } else {
      this.segments.pop();
    }

    return true;
  }

  public reset(): void {
    this.score = 0;
    this.alive = true;
    this.paused = false;
    this.currentDirection = "RIGHT";
    this.nextDirection = "RIGHT";
    this.movesCount = 0;
    this.applesEaten = 0;
    this.head = { x: Math.floor(this.width / 2), y: Math.floor(this.height / 2) };
    this.segments = [
      { x: this.head.x - 1, y: this.head.y },
      { x: this.head.x - 2, y: this.head.y },
    ];
    this.food = this.spawnFood();
    this.goldenFood = null;
  }

  public changeDirection(newDir: Direction): boolean {
    if (this.currentDirection === "UP" && newDir === "DOWN") return false;
    if (this.currentDirection === "DOWN" && newDir === "UP") return false;
    if (this.currentDirection === "LEFT" && newDir === "RIGHT") return false;
    if (this.currentDirection === "RIGHT" && newDir === "LEFT") return false;
    this.nextDirection = newDir;
    return true;
  }

  public spawnFood(): Point {
    const occupied = new Set<string>();
    occupied.add(`${this.head.x},${this.head.y}`);
    for (const seg of this.segments) {
      occupied.add(`${seg.x},${seg.y}`);
    }

    let candidateX = Math.floor(Math.random() * this.width);
    let candidateY = Math.floor(Math.random() * this.height);
    let attempts = 0;

    while (occupied.has(`${candidateX},${candidateY}`) && attempts < 100) {
      candidateX = Math.floor(Math.random() * this.width);
      candidateY = Math.floor(Math.random() * this.height);
      attempts += 1;
    }

    return { x: candidateX, y: candidateY };
  }

  public checkWallCollision(pos: Point): boolean {
    return pos.x < 0 || pos.x >= this.width || pos.y < 0 || pos.y >= this.height;
  }

  public checkSelfCollision(pos: Point): boolean {
    for (const seg of this.segments) {
      if (seg.x === pos.x && seg.y === pos.y) {
        return true;
      }
    }
    return false;
  }

  public getLength(): number {
    return 1 + this.segments.length;
  }

  public getStats(): EngineStats {
    return {
      score: this.score,
      highScore: this.highScore,
      applesEaten: this.applesEaten,
      movesCount: this.movesCount,
      aliveTimeSeconds: 0,
    };
  }

  public isOccupied(x: number, y: number): boolean {
    if (this.head.x === x && this.head.y === y) return true;
    for (const seg of this.segments) {
      if (seg.x === x && seg.y === y) return true;
    }
    return false;
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
  }

  public isAlive(): boolean {
    return this.alive;
  }

  public getScore(): number {
    return this.score;
  }

  private getNextHeadPosition(): Point {
    switch (this.currentDirection) {
      case "UP":
        return { x: this.head.x, y: this.head.y - 1 };
      case "DOWN":
        return { x: this.head.x, y: this.head.y + 1 };
      case "LEFT":
        return { x: this.head.x - 1, y: this.head.y };
      case "RIGHT":
        return { x: this.head.x + 1, y: this.head.y };
    }
  }

  public calculateScoreMultiplier(): number {
    let multiplier = 1;
    if (this.applesEaten > 10) multiplier = 2;
    if (this.applesEaten > 25) multiplier = 3;
    if (this.applesEaten > 50) multiplier = 5;
    return multiplier;
  }

  public serialize(): string {
    const payload = {
      score: this.score,
      highScore: this.highScore,
      alive: this.alive,
      head: this.head,
      segments: this.segments,
      moves: this.movesCount,
    };
    return JSON.stringify(payload);
  }

  public renderAscii(): string {
    const grid: string[][] = [];
    for (let r = 0; r < this.height; r++) {
      grid.push(new Array(this.width).fill("."));
    }
    grid[this.head.y][this.head.x] = "@";
    for (const seg of this.segments) {
      grid[seg.y][seg.x] = "o";
    }
    grid[this.food.y][this.food.x] = "*";
    return grid.map((row) => row.join("")).join("\n");
  }

  public tickPhysics(deltaSeconds: number): void {
    if (!this.alive) return;
    this.step();
  }

  public applyPowerup(type: string, durationSeconds: number): void {
    if (type === "speed") {
      this.movesCount += 2;
    } else if (type === "shield") {
      this.score += 50;
    } else if (type === "double_points") {
      this.score += 100;
    }
  }

  public getDebugInfo(): string {
    const lines: string[] = [];
    lines.push("Score: " + this.score);
    lines.push("Alive: " + this.alive);
    lines.push("Direction: " + this.currentDirection);
    lines.push("Length: " + this.getLength());
    lines.push("Head: " + this.head.x + "," + this.head.y);
    return lines.join("; ");
  }

  public validateState(): boolean {
    if (this.head.x < 0 || this.head.x >= this.width) return false;
    if (this.head.y < 0 || this.head.y >= this.height) return false;
    if (this.segments.length < 1) return false;
    return true;
  }
}
