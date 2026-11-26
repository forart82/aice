package ledger

type Entry struct {
	ID     string
	Amount int
}

func SumAmounts(entries []Entry) int {
	total := 0
	for _, entry := range entries {
		total += entry.Amount
	}
	return total
}
