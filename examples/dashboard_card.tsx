export interface MetricCardProps {
  title: string;
  currentValue: number;
  previousValue: number;
  trend: string;
  isPositive: boolean;
}

export function MetricCard({ title, currentValue, previousValue, trend, isPositive }: MetricCardProps) {
  return (
  <div className="relative overflow-hidden rounded-2xl bg-slate-900/90 p-6 border border-slate-800 shadow-xl"><header className="flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-400 tracking-wider uppercase">{title}</h3><span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400">{trend}</span></header><div className="mt-4 flex items-baseline gap-2"><span className="text-3xl font-extrabold text-white tracking-tight">{currentValue}</span><span className="text-xs font-medium text-slate-500">vs last cycle</span></div></div>
  );
}
