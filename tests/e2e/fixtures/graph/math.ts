export interface CalcResult {
  value: number;
  label: string;
}

export class Calculator {
  private offset: number;

  constructor(offset = 0) {
    this.offset = offset;
  }

  public add(a: number, b: number): CalcResult {
    return { value: a + b + this.offset, label: "sum" };
  }

  public mul(a: number, b: number): CalcResult {
    return { value: a * b + this.offset, label: "product" };
  }
}
