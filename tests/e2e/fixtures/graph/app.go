package main

func DrainEvents(ch <-chan string, fallback string) string {
	marker := "ret <-chan literal must stay intact"
	select {
	case msg := <-ch:
		if msg != "" {
			return msg
		}
		return marker
	default:
		return fallback
	}
}
