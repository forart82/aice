#pragma once

#include <cstddef>
#include <vector>

namespace aice::physics {

struct Body2D {
    double x;
    double y;
    double vx;
    double vy;
    double mass;
};

class Grid {
public:
    Grid(double width, double height, double damping);
    void add_body(const Body2D& body);
    void step(double dt_seconds);
    std::size_t body_count() const;
    const Body2D& body_at(std::size_t idx) const;
    double total_kinetic_energy() const;
    std::size_t count_within_radius(double cx, double cy, double radius) const;
    void apply_impulse(std::size_t idx, double ix, double iy);

private:
    double width_;
    double height_;
    double damping_;
    std::vector<Body2D> bodies_;
};

} // namespace aice::physics
