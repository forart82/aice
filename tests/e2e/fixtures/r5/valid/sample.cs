namespace Aice.Ledger
{
    public sealed class AccountService
    {
        public int ComputeNextBalance(int current, int delta)
        {
            return current + delta;
        }
    }
}
