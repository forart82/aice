export interface DashboardCardProps {
  title: string;
  badge: string;
  description: string;
}

export function DashboardCard({ title, badge, description }: DashboardCardProps) {
  return (
    <div className="card-container">
      <div className="card-header">
        <h2 className="card-title">{title}</h2>
        <span className="card-badge">{badge}</span>
      </div>
      <p className="card-body">{description}</p>
    </div>
  );
}
