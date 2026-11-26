import { Calculator, type CalcResult } from "./math.js";

export class App {
  private calc: Calculator;
  private count = 0;

  constructor(offset = 1) {
    this.calc = new Calculator(offset);
  }

  /** Increment counter and compute sum */
  public inc(step: number): CalcResult {
    this.count += step;
    return this.calc.add(this.count, step);
  }

  public reset(): number {
    this.count = 0;
    return this.count;
  }
}
