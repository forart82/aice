#include "helpers/DeterministicRandom.hpp"

#include <stdexcept>

namespace dof::helpers {

namespace {

std::uint64_t splitmix64(std::uint64_t& state) {
    state += 0x9E3779B97F4A7C15ULL;
    std::uint64_t z = state;
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
    return z ^ (z >> 31);
}

inline std::uint32_t rotl(std::uint32_t x, int k) {
    return (x << k) | (x >> (32 - k));
}

}  // namespace

DeterministicRandom::DeterministicRandom(std::uint64_t seed) { reseed(seed); }

void DeterministicRandom::reseed(std::uint64_t seed) {
    seedValue = seed;
    std::uint64_t sm = seed;
    s0 = static_cast<std::uint32_t>(splitmix64(sm) & 0xFFFFFFFFULL);
    s1 = static_cast<std::uint32_t>(splitmix64(sm) & 0xFFFFFFFFULL);
    s2 = static_cast<std::uint32_t>(splitmix64(sm) & 0xFFFFFFFFULL);
    s3 = static_cast<std::uint32_t>(splitmix64(sm) & 0xFFFFFFFFULL);
    if ((s0 | s1 | s2 | s3) == 0) s0 = 1;
}

std::uint64_t DeterministicRandom::currentSeed() const { return seedValue; }

std::uint32_t DeterministicRandom::next32() {
    const std::uint32_t result = rotl(s1 * 5u, 7) * 9u;
    const std::uint32_t t = s1 << 9;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    return result;
}

int DeterministicRandom::uniformInt(int lo, int hi) {
    if (hi < lo) throw std::invalid_argument("DeterministicRandom::uniformInt: hi < lo");
    const std::uint32_t range = static_cast<std::uint32_t>(hi - lo) + 1u;
    if (range == 0u) return lo + static_cast<int>(next32());
    std::uint32_t x = next32();
    std::uint64_t m = static_cast<std::uint64_t>(x) * static_cast<std::uint64_t>(range);
    std::uint32_t low = static_cast<std::uint32_t>(m);
    if (low < range) {
        const std::uint32_t threshold = (0u - range) % range;
        while (low < threshold) {
            x = next32();
            m = static_cast<std::uint64_t>(x) * static_cast<std::uint64_t>(range);
            low = static_cast<std::uint32_t>(m);
        }
    }
    return lo + static_cast<int>(m >> 32);
}

float DeterministicRandom::uniformFloat(float lo, float hi) {
    if (hi < lo) throw std::invalid_argument("DeterministicRandom::uniformFloat: hi < lo");
    const std::uint32_t bits = next32() >> 8;
    const float x = static_cast<float>(bits) * (1.0f / 16777216.0f);
    return lo + (hi - lo) * x;
}

bool DeterministicRandom::bernoulli(float probability) {
    // Draw FIRST, unconditionally. Returning early at the boundaries consumed
    // zero draws there and one draw otherwise, so flipping a config chance
    // between 0.0 and 0.001 shifted every subsequent draw in the run and broke
    // --seed reproducibility for reasons unrelated to the change.
    const float roll = uniformFloat(0.0f, 1.0f);
    if (probability <= 0.0f) return false;
    if (probability >= 1.0f) return true;
    return roll < probability;
}

float DeterministicRandom::angleRadians() {
    return uniformFloat(0.0f, 6.28318530717958647692f);
}

}  // namespace dof::helpers
