#include "render/FpsHistory.hpp"

#include <algorithm>

namespace dof::render {

FpsHistory::FpsHistory(std::size_t capacity)
    : ring(capacity, 0.0f), ringCapacity(capacity) {}

void FpsHistory::push(float fps) {
    if (ringCapacity == 0) return;
    if (fps < 0.0f) fps = 0.0f;
    ring[writeIndex] = fps;
    writeIndex = (writeIndex + 1) % ringCapacity;
    if (storedCount < ringCapacity) ++storedCount;
}

std::size_t FpsHistory::size() const     { return storedCount; }
std::size_t FpsHistory::capacity() const { return ringCapacity; }

std::vector<float> FpsHistory::samples() const {
    std::vector<float> out;
    out.reserve(storedCount);
    if (storedCount == 0) return out;
    // When the buffer hasn't wrapped yet, samples live at [0, storedCount).
    // After wrap, the oldest sample sits at `writeIndex` and the newest at
    // `(writeIndex - 1 + ringCapacity) % ringCapacity`.
    if (storedCount < ringCapacity) {
        for (std::size_t i = 0; i < storedCount; ++i) out.push_back(ring[i]);
    } else {
        for (std::size_t i = 0; i < ringCapacity; ++i) {
            out.push_back(ring[(writeIndex + i) % ringCapacity]);
        }
    }
    return out;
}

float FpsHistory::min() const {
    if (storedCount == 0) return 0.0f;
    const auto samplesOrdered = samples();
    return *std::min_element(samplesOrdered.begin(), samplesOrdered.end());
}

float FpsHistory::max() const {
    if (storedCount == 0) return 0.0f;
    const auto samplesOrdered = samples();
    return *std::max_element(samplesOrdered.begin(), samplesOrdered.end());
}

float FpsHistory::average() const {
    if (storedCount == 0) return 0.0f;
    const auto samplesOrdered = samples();
    float sum = 0.0f;
    for (float value : samplesOrdered) sum += value;
    return sum / static_cast<float>(storedCount);
}

}
