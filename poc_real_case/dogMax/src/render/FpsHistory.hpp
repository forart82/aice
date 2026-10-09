#pragma once

// Spec §Tabs §Performance Tab L2848 — "FPS history graph (last 120
// frames)". Fixed-capacity ring buffer that records the most recent N
// FPS samples. Constant-time push, O(N) iteration for the graph
// painter. No SFML dependency so the class is trivially unit-testable.

#include <cstddef>
#include <vector>

namespace dof::render {

class FpsHistory {
public:
    explicit FpsHistory(std::size_t capacity);

    // Push the next FPS sample. Overwrites the oldest sample once the
    // buffer is full (ring semantics). Negative inputs are clamped to
    // 0 so a transient `-nan` from the timing path never leaks into
    // the graph.
    void push(float fps);

    // Number of samples currently stored. Grows from 0 → capacity()
    // then stays at capacity().
    std::size_t size() const;
    std::size_t capacity() const;

    // Returns the samples in insertion order (oldest → newest). Empty
    // when no samples have been pushed yet.
    std::vector<float> samples() const;

    // Min / max / average across the currently-stored window. Returns
    // 0.0f when `size() == 0`.
    float min() const;
    float max() const;
    float average() const;

private:
    std::vector<float> ring;
    std::size_t        ringCapacity;
    std::size_t        writeIndex{0};
    std::size_t        storedCount{0};
};

}
