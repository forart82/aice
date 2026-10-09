#pragma once

#include <algorithm>

namespace dof::hubs {

template <typename EventContainer, typename DurationFn>
void ageAndExpire(EventContainer& events, float dt, DurationFn durationFor) {
    for (auto& event : events) event.age += dt;
    events.erase(
        std::remove_if(events.begin(), events.end(),
                       [&](const auto& event) { return event.age >= durationFor(event); }),
        events.end());
}

}  // namespace dof::hubs
