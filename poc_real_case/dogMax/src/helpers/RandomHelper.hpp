#pragma once

// RandomHelper is now a compatibility alias for DeterministicRandom — the game's
// reproducible RNG (see spec/random/DeterministicRandom.md). The old
// std::mt19937_64 + std::uniform_*_distribution implementation was not
// bit-reproducible across platforms and was replaced wholesale. Existing call sites
// that spell the type `RandomHelper` keep compiling unchanged.

#include "helpers/DeterministicRandom.hpp"

namespace dof::helpers {

using RandomHelper = DeterministicRandom;

}  // namespace dof::helpers
