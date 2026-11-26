class LedgerAccount
  attr_reader :balance

  def initialize(initial = 0)
    @balance = initial
  end

  def credit(amount)
    raise ArgumentError, "negative" if amount.negative?
    @balance += amount
  end
end
