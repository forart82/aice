// @ts-nocheck
import type { CalcResult } from "./math.js";

export interface CardProps {
  title: string;
  result: CalcResult;
}

export function StatusCard(props: CardProps) {
  return (
    <section className="status-card">
      <h2>{props.title}</h2>
      <span>{props.result.value}</span>
    </section>
  );
}
