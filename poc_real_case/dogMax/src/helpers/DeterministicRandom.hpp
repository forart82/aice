#pragma once

// DeterministicRandom — the game's reproducible RNG. See spec/random/DeterministicRandom.md.
//
// Engine: xoshiro128** seeded by SplitMix64. uniformInt: Lemire bounded multiply with
// rejection. uniformFloat: 24-bit mantissa, float32 throughout. This replaces the old
// std::mt19937_64 + std::uniform_*_distribution, whose distributions were not reproducible
// across platforms.

#include <cstdint>

namespace dof::helpers {

class DeterministicRandom {
public:
    explicit DeterministicRandom(std::uint64_t seed);

    void          reseed(std::uint64_t seed);
    std::uint64_t currentSeed() const;

    std::uint32_t next32();

    int   uniformInt(int lo, int hi);
    float uniformFloat(float lo, float hi);
    bool  bernoulli(float probability);
    float angleRadians();

private:
    std::uint64_t seedValue;
    std::uint32_t s0, s1, s2, s3;
};

}  // namespace dof::helpers
