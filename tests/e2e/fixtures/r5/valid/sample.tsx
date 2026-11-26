export interface StatusCardProps {
  title: string;
  active: boolean;
}

export function StatusCard({ title, active }: StatusCardProps) {
  return (
    <section className={active ? "card card--active" : "card"}>
      <h2>{title}</h2>
      <span>{active ? "ONLINE" : "IDLE"}</span>
    </section>
  );
}
