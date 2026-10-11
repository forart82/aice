export type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";
export type GameMode = "CLASSIC" | "WARP" | "OBSTACLES";
export class SnakeAI {
  static getNextMove(_state: any): Direction {
    return "UP";
  }
}
export class GameEngine {
  constructor(_opts?: any) {}
  getState(): any {
    return {
      score: 0,
      highScore: 0,
      level: 1,
      combo: 1,
      stats: { foodsEaten: 0, maxCombo: 1 },
      activeEffects: [] as any[],
      isGameOver: false,
      isPaused: false,
    };
  }
  setDirection(_dir: Direction): void {}
  step(): any[] {
    return [];
  }
  togglePause(): void {}
  restart(): void {}
  getTickInterval(): number {
    return 100;
  }
}

// ANSI escape sequences
const ANSI = {
  enterAltScreen: '\x1b[?1049h',
  leaveAltScreen: '\x1b[?1049l',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  clear: '\x1b[2J\x1b[H',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  // Colors
  cyan: '\x1b[36m',
  brightCyan: '\x1b[36;1m',
  green: '\x1b[32m',
  brightGreen: '\x1b[32;1m',
  yellow: '\x1b[33m',
  brightYellow: '\x1b[33;1m',
  magenta: '\x1b[35m',
  brightMagenta: '\x1b[35;1m',
  red: '\x1b[31m',
  brightRed: '\x1b[31;1m',
  white: '\x1b[37;1m',
  gray: '\x1b[90m',
  bgDark: '\x1b[40m',
};

class TerminalSnakeGame {
  private engine: GameEngine;
  private isAIBotActive: boolean = false;
  private isRunning: boolean = true;
  private timer: NodeJS.Timeout | null = null;
  private width: number = 22;
  private height: number = 18;
  private currentMode: GameMode = 'CLASSIC';

  constructor() {
    this.engine = new GameEngine({
      width: this.width,
      height: this.height,
      mode: this.currentMode,
      difficulty: 'MEDIUM',
    });

    this.setupExitHandlers();
    this.setupInput();
  }

  private setupExitHandlers(): void {
    const cleanup = () => {
      this.isRunning = false;
      if (this.timer) clearTimeout(this.timer);
      process.stdout.write(ANSI.showCursor + ANSI.leaveAltScreen);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', () => {
      process.stdout.write(ANSI.showCursor + ANSI.leaveAltScreen);
    });
  }

  private setupInput(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (key: string) => {
      // Ctrl+C or 'q'
      if (key === '\u0003' || key.toLowerCase() === 'q') {
        this.exit();
        return;
      }

      // 'p' for pause
      if (key.toLowerCase() === 'p') {
        this.engine.togglePause();
        this.render();
        return;
      }

      // 'r' for restart
      if (key.toLowerCase() === 'r') {
        this.engine.restart();
        this.render();
        return;
      }

      // 'b' for AI Bot toggle
      if (key.toLowerCase() === 'b') {
        this.isAIBotActive = !this.isAIBotActive;
        this.render();
        return;
      }

      // 'm' to cycle game mode
      if (key.toLowerCase() === 'm') {
        const modes: GameMode[] = ['CLASSIC', 'OBSTACLES', 'WARP'];
        const nextIndex = (modes.indexOf(this.currentMode) + 1) % modes.length;
        this.currentMode = modes[nextIndex];
        const state = this.engine.getState();
        this.engine = new GameEngine({
          width: this.width,
          height: this.height,
          mode: this.currentMode,
          difficulty: state.difficulty,
          highScore: state.highScore,
        });
        this.render();
        return;
      }

      // If AI Bot is driving, human arrow keys will disable AI Bot and take over
      let dir: Direction | null = null;
      if (key === '\x1b[A' || key.toLowerCase() === 'w') dir = 'UP';
      else if (key === '\x1b[B' || key.toLowerCase() === 's') dir = 'DOWN';
      else if (key === '\x1b[D' || key.toLowerCase() === 'a') dir = 'LEFT';
      else if (key === '\x1b[C' || key.toLowerCase() === 'd') dir = 'RIGHT';

      if (dir) {
        this.isAIBotActive = false;
        this.engine.setDirection(dir);
        this.render();
      }
    });
  }

  public start(): void {
    process.stdout.write(ANSI.enterAltScreen + ANSI.hideCursor);
    this.tick();
  }

  private exit(): void {
    this.isRunning = false;
    if (this.timer) clearTimeout(this.timer);
    process.stdout.write(ANSI.showCursor + ANSI.leaveAltScreen);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.exit(0);
  }

  private tick(): void {
    if (!this.isRunning) return;

    const state = this.engine.getState();

    if (!state.isPaused && !state.isGameOver) {
      if (this.isAIBotActive) {
        const nextDir = SnakeAI.getNextMove(state);
        this.engine.setDirection(nextDir);
      }
      this.engine.step();
    }

    this.render();

    const interval = this.engine.getTickInterval();
    this.timer = setTimeout(() => this.tick(), interval);
  }

  private render(): void {
    const state = this.engine.getState();
    const lines: string[] = [];

    // Header Title
    lines.push(
      `${ANSI.brightCyan}╔═══════════════════════════════════════════════════════╗${ANSI.reset}`
    );
    lines.push(
      `${ANSI.brightCyan}║${ANSI.bold}${ANSI.brightYellow}          ★ CYBER SNAKE TS // TERMINAL EDITION ★        ${ANSI.brightCyan}║${ANSI.reset}`
    );
    lines.push(
      `${ANSI.brightCyan}╚═══════════════════════════════════════════════════════╝${ANSI.reset}`
    );

    // Status Bar
    const botStatus = this.isAIBotActive
      ? `${ANSI.brightMagenta}[AI BOT ON]${ANSI.reset}`
      : `${ANSI.gray}[MANUAL]${ANSI.reset}`;

    const comboStr =
      state.combo > 1
        ? `${ANSI.brightYellow}x${state.combo} COMBO!${ANSI.reset}`
        : `${ANSI.gray}x1${ANSI.reset}`;

    const activeBuffs: string[] = [];
    if (state.activeEffects.some((e: any) => e.type === 'SPEED_BOOST')) {
      activeBuffs.push(`${ANSI.brightYellow}⚡SPEED${ANSI.reset}`);
    }
    if (state.activeEffects.some((e: any) => e.type === 'POISON')) {
      activeBuffs.push(`${ANSI.brightMagenta}☠POISON${ANSI.reset}`);
    }
    const buffStr = activeBuffs.length > 0 ? activeBuffs.join(' ') : `${ANSI.gray}None${ANSI.reset}`;

    lines.push(
      ` ${ANSI.white}Score:${ANSI.brightGreen} ${state.score.toString().padEnd(5)}${ANSI.reset} ` +
        `${ANSI.white}High:${ANSI.brightYellow} ${state.highScore.toString().padEnd(5)}${ANSI.reset} ` +
        `${ANSI.white}Lvl:${ANSI.brightCyan} ${state.level}${ANSI.reset} ` +
        `${ANSI.white}Combo:${ANSI.reset} ${comboStr}  ` +
        `${ANSI.white}Mode:${ANSI.brightCyan} ${state.mode}${ANSI.reset}  ` +
        `${botStatus}`
    );
    lines.push(` ${ANSI.dim}Buffs: ${buffStr}${ANSI.reset}`);
    lines.push('');

    // Grid Construction
    // Each cell is 2 characters wide for square proportions
    const grid: string[][] = Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => '  ')
    );

    // Place obstacles
    for (const obs of state.obstacles) {
      if (obs.x >= 0 && obs.x < this.width && obs.y >= 0 && obs.y < this.height) {
        grid[obs.y][obs.x] = `${ANSI.gray}██${ANSI.reset}`;
      }
    }

    // Place foods
    for (const food of state.foods) {
      if (food.position.x >= 0 && food.position.x < this.width && food.position.y >= 0 && food.position.y < this.height) {
        let icon = '◆ ';
        switch (food.type) {
          case 'NORMAL':
            icon = `${ANSI.brightRed}♥ ${ANSI.reset}`;
            break;
          case 'GOLDEN':
            icon = `${ANSI.brightYellow}★ ${ANSI.reset}`;
            break;
          case 'SPEED_BOOST':
            icon = `${ANSI.brightCyan}⚡${ANSI.reset} `;
            break;
          case 'POISON':
            icon = `${ANSI.brightMagenta}☠ ${ANSI.reset}`;
            break;
        }
        grid[food.position.y][food.position.x] = icon;
      }
    }

    // Place snake body
    const body = state.snake.body;
    for (let i = body.length - 1; i >= 0; i--) {
      const seg = body[i];
      if (seg.x >= 0 && seg.x < this.width && seg.y >= 0 && seg.y < this.height) {
        if (i === 0) {
          // Head with direction arrow
          let headChar = '► ';
          if (state.snake.direction === 'UP') headChar = '▲ ';
          else if (state.snake.direction === 'DOWN') headChar = '▼ ';
          else if (state.snake.direction === 'LEFT') headChar = '◄ ';
          else if (state.snake.direction === 'RIGHT') headChar = '► ';

          const headColor = state.isGameOver ? ANSI.brightRed : ANSI.brightGreen;
          grid[seg.y][seg.x] = `${headColor}${headChar}${ANSI.reset}`;
        } else {
          // Body segment
          const color = i % 2 === 0 ? ANSI.green : ANSI.brightGreen;
          grid[seg.y][seg.x] = `${color}██${ANSI.reset}`;
        }
      }
    }

    // Top border
    lines.push(`┌${'──'.repeat(this.width)}┐`);

    // Grid rows
    for (let y = 0; y < this.height; y++) {
      let rowStr = '│';
      for (let x = 0; x < this.width; x++) {
        rowStr += grid[y][x];
      }
      rowStr += '│';

      // Overlay Game Over box in the center if game over
      if (state.isGameOver) {
        const midY = Math.floor(this.height / 2);
        if (y === midY - 2) {
          rowStr = `│${'  '.repeat(Math.floor((this.width - 10) / 2))}${ANSI.brightRed}${ANSI.bold}╔════════════════════╗${ANSI.reset}${'  '.repeat(Math.ceil((this.width - 10) / 2))}│`;
        } else if (y === midY - 1) {
          rowStr = `│${'  '.repeat(Math.floor((this.width - 10) / 2))}${ANSI.brightRed}${ANSI.bold}║    GAME OVER!      ║${ANSI.reset}${'  '.repeat(Math.ceil((this.width - 10) / 2))}│`;
        } else if (y === midY) {
          const scoreMsg = `Score: ${state.score}`.padStart(12).padEnd(20);
          rowStr = `│${'  '.repeat(Math.floor((this.width - 10) / 2))}${ANSI.brightYellow}${ANSI.bold}║${scoreMsg}║${ANSI.reset}${'  '.repeat(Math.ceil((this.width - 10) / 2))}│`;
        } else if (y === midY + 1) {
          rowStr = `│${'  '.repeat(Math.floor((this.width - 10) / 2))}${ANSI.brightRed}${ANSI.bold}║ [R] Restart [Q]Quit║${ANSI.reset}${'  '.repeat(Math.ceil((this.width - 10) / 2))}│`;
        } else if (y === midY + 2) {
          rowStr = `│${'  '.repeat(Math.floor((this.width - 10) / 2))}${ANSI.brightRed}${ANSI.bold}╚════════════════════╝${ANSI.reset}${'  '.repeat(Math.ceil((this.width - 10) / 2))}│`;
        }
      } else if (state.isPaused) {
        const midY = Math.floor(this.height / 2);
        if (y === midY) {
          rowStr = `│${'  '.repeat(Math.floor((this.width - 8) / 2))}${ANSI.brightYellow}${ANSI.bold} [PAUSED - Press P] ${ANSI.reset}${'  '.repeat(Math.ceil((this.width - 8) / 2))}│`;
        }
      }

      lines.push(rowStr);
    }

    // Bottom border
    lines.push(`└${'──'.repeat(this.width)}┘`);

    // Controls Legend
    lines.push('');
    lines.push(
      `${ANSI.dim}Controls:${ANSI.reset} ${ANSI.white}[WASD/Arrows]${ANSI.reset} Move  ` +
        `${ANSI.white}[P]${ANSI.reset} Pause  ` +
        `${ANSI.white}[R]${ANSI.reset} Restart  ` +
        `${ANSI.white}[B]${ANSI.reset} AI Bot  ` +
        `${ANSI.white}[M]${ANSI.reset} Mode  ` +
        `${ANSI.white}[Q]${ANSI.reset} Quit`
    );

    // Write all to stdout in single flush to prevent flicker
    process.stdout.write(ANSI.clear + lines.join('\n') + '\n');
  }
}

// CLI Arguments handling
const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log('snake-ts v1.0.0');
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Cyber Snake TS - Retro Arcade Terminal Edition

Usage:
  node dist/cli/terminal.js [options]

Options:
  --help, -h       Show this help message
  --version, -v    Display version number
  --headless       Run headless AI simulation without TTY
  --test           Run automated verification test
  --ticks <N>      Specify tick count for headless/test mode (default: 100)
  --mode <MODE>    Game mode: CLASSIC, OBSTACLES, WARP (default: CLASSIC)
`);
  process.exit(0);
}

if (args.includes('--headless') || args.includes('--test')) {
  const tickIdx = args.indexOf('--ticks');
  const tickCount = tickIdx !== -1 && args[tickIdx + 1] ? parseInt(args[tickIdx + 1], 10) : 100;
  const modeIdx = args.indexOf('--mode');
  const selectedMode = (modeIdx !== -1 && args[modeIdx + 1] ? args[modeIdx + 1].toUpperCase() : 'CLASSIC') as GameMode;

  console.log(`\n🐍 [Cyber Snake TS] Running Headless AI Simulation...`);
  console.log(`   Mode: ${selectedMode} | Ticks Target: ${tickCount}\n`);

  const engine = new GameEngine({ width: 22, height: 18, mode: selectedMode });
  let ticks = 0;

  while (ticks < tickCount && !engine.getState().isGameOver) {
    const dir = SnakeAI.getNextMove(engine.getState());
    engine.setDirection(dir);
    engine.step();
    ticks++;
  }

  const finalState = engine.getState();
  console.log(`══════════════════════════════════════════`);
  console.log(`Simulation Complete:`);
  console.log(`  Ticks Survived: ${ticks} / ${tickCount}`);
  console.log(`  Final Score:    ${finalState.score}`);
  console.log(`  Snake Length:   ${finalState.snake.body.length}`);
  console.log(`  Foods Eaten:    ${finalState.stats.foodsEaten}`);
  console.log(`  Golden Foods:   ${finalState.stats.goldenEaten}`);
  console.log(`  Max Combo:      x${finalState.stats.maxCombo}`);
  console.log(`  Game Over:      ${finalState.isGameOver}`);
  console.log(`══════════════════════════════════════════\n`);

  if (args.includes('--test') && finalState.isGameOver && ticks < Math.min(tickCount, 50)) {
    console.error('❌ Test failed: Snake died prematurely!');
    process.exit(1);
  }

  console.log('✅ Headless simulation verified successfully.');
  process.exit(0);
}

// Check if running in a non-interactive environment without flags
if (!process.stdin.isTTY) {
  console.log('Non-interactive environment detected. Use --headless or --test to run non-interactively.');
  process.exit(0);
}

// Start terminal game if executed directly
const game = new TerminalSnakeGame();
game.start();
