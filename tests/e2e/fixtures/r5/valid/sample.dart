class LedgerBalance {
  int _amount;

  LedgerBalance(this._amount);

  int add(int delta) {
    _amount += delta;
    return _amount;
  }
}
