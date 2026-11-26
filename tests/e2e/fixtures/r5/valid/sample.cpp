#include <cstdint>

class LedgerCounter {
public:
    explicit LedgerCounter(int64_t initial = 0) : total_(initial) {}

    int64_t add(int64_t delta) {
        total_ += delta;
        return total_;
    }

private:
    int64_t total_;
};
