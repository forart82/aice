import React from 'react';
import type { AnalyticsSummary, OrderRecord } from './types';
import { formatCurrencyCents, validateOrder } from './validators';

export interface OrdersPanelProps {
  merchantName: string;
  summary: AnalyticsSummary;
  orders: OrderRecord[];
  loading: boolean;
  errorMessage: string | null;
  onSelectOrder: (orderId: string) => void;
}

export function OrdersPanel({
  merchantName,
  summary,
  orders,
  loading,
  errorMessage,
  onSelectOrder,
}: OrdersPanelProps): React.ReactElement {
  if (loading) {
    return <section className="panel panel-loading">Loading analytics for {merchantName}...</section>;
  }
  if (errorMessage) {
    return <section className="panel panel-error">Failed to load orders: {errorMessage}</section>;
  }

  const validOrders = orders.filter((item) => validateOrder(item).length === 0);

  return (
    <section className="orders-dashboard">
      <header className="dashboard-header">
        <h2>{merchantName} Orders</h2>
        <span className="badge-count">{summary.totalCount} total</span>
      </header>
      <div className="metric-grid">
        <article className="metric-card">
          <span className="metric-label">Settled Volume</span>
          <strong className="metric-value">{formatCurrencyCents(summary.settledVolumeCents, 'USD')}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Average Ticket</span>
          <strong className="metric-value">{formatCurrencyCents(summary.averageTicketCents, 'USD')}</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Flagged Orders</span>
          <strong className="metric-value">{summary.flaggedCount}</strong>
        </article>
      </div>
      {validOrders.length === 0 ? (
        <p className="empty-state">No valid orders match the current filter.</p>
      ) : (
        <table className="orders-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Amount</th>
              <th>Fee</th>
            </tr>
          </thead>
          <tbody>
            {validOrders.map((order) => (
              <tr key={order.id} onClick={() => onSelectOrder(order.id)}>
                <td>{order.id}</td>
                <td>{order.status}</td>
                <td>{formatCurrencyCents(order.amountCents, order.currency)}</td>
                <td>{formatCurrencyCents(order.feeCents, order.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
