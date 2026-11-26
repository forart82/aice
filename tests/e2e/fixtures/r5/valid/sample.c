#include <stdint.h>

typedef struct {
    int32_t count;
    int64_t sum;
} LedgerWindow;

int64_t ledger_push(LedgerWindow *win, int32_t value) {
    win->count += 1;
    win->sum += value;
    return win->sum;
}
