using System;
using System.Collections.Generic;
using System.Linq;

namespace Aice.Settlement
{
    public sealed record LedgerItem(string Id, string MerchantId, long ExpectedNet, long ActualNet);

    public sealed record ReconcileSummary(
        int TotalItems,
        int MatchedCount,
        int DiscrepancyCount,
        long TotalVarianceMinorUnits);

    public class ReconcileEngine
    {
        private readonly long _toleranceMinorUnits;

        public ReconcileEngine(long toleranceMinorUnits)
        {
            if (toleranceMinorUnits < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(toleranceMinorUnits));
            }
            _toleranceMinorUnits = toleranceMinorUnits;
        }

        public ReconcileSummary ReconcileBatch(IEnumerable<LedgerItem> items)
        {
            if (items == null)
            {
                throw new ArgumentNullException(nameof(items));
            }

            var list = items.ToList();
            int matched = 0;
            int discrepancies = 0;
            long totalVariance = 0;

            foreach (var item in list)
            {
                long delta = Math.Abs(item.ExpectedNet - item.ActualNet);
                totalVariance += delta;
                if (delta <= _toleranceMinorUnits)
                {
                    matched++;
                }
                else
                {
                    discrepancies++;
                }
            }

            return new ReconcileSummary(list.Count, matched, discrepancies, totalVariance);
        }

        public IReadOnlyList<LedgerItem> FindUnmatched(IEnumerable<LedgerItem> items)
        {
            if (items == null)
            {
                throw new ArgumentNullException(nameof(items));
            }
            return items
                .Where(item => Math.Abs(item.ExpectedNet - item.ActualNet) > _toleranceMinorUnits)
                .OrderByDescending(item => Math.Abs(item.ExpectedNet - item.ActualNet))
                .ToList();
        }

        public IReadOnlyDictionary<string, long> VarianceByMerchant(IEnumerable<LedgerItem> items)
        {
            if (items == null)
            {
                throw new ArgumentNullException(nameof(items));
            }
            var totals = new Dictionary<string, long>(StringComparer.Ordinal);
            foreach (var item in items)
            {
                long delta = Math.Abs(item.ExpectedNet - item.ActualNet);
                if (delta > _toleranceMinorUnits)
                {
                    totals[item.MerchantId] = totals.GetValueOrDefault(item.MerchantId, 0L) + delta;
                }
            }
            return totals;
        }
    }
}
