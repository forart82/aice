namespace Billing {

public sealed class Invoice {
    public string Id { get; }
    public decimal Total { get; }

    public Invoice(string id, decimal total) {
        Id = id;
        Total = total;
    }

    public decimal WithTax(decimal rate) {
        return Total + (Total * rate);
    }
}

}
