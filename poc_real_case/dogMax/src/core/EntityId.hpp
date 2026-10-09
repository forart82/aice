#pragma once

#include <cstdint>

namespace dof::core {

struct EntityId {
    std::uint64_t value{0};
    bool operator==(EntityId other) const { return value == other.value; }
    bool operator!=(EntityId other) const { return value != other.value; }
};

}
