#include "physics_grid.hpp"

#include <algorithm>
#include <stdexcept>

namespace aice::physics {

Grid::Grid(double width, double height, double damping)
    : width_(width), height_(height), damping_(damping) {
    if (width_ <= 0.0 || height_ <= 0.0) {
        throw std::invalid_argument("grid dimensions must be positive");
    }
    damping_ = std::clamp(damping_, 0.0, 1.0);
}

void Grid::add_body(const Body2D& body) {
    bodies_.push_back(body);
}

void Grid::step(double dt_seconds) {
    if (dt_seconds <= 0.0) {
        return;
    }
    for (auto& body : bodies_) {
        body.x += body.vx * dt_seconds;
        body.y += body.vy * dt_seconds;
        if (body.x < 0.0) {
            body.x = 0.0;
            body.vx = -body.vx * damping_;
        } else if (body.x > width_) {
            body.x = width_;
            body.vx = -body.vx * damping_;
        }
        if (body.y < 0.0) {
            body.y = 0.0;
            body.vy = -body.vy * damping_;
        } else if (body.y > height_) {
            body.y = height_;
            body.vy = -body.vy * damping_;
        }
    }
}

std::size_t Grid::body_count() const {
    return bodies_.size();
}

const Body2D& Grid::body_at(std::size_t idx) const {
    return bodies_.at(idx);
}

double Grid::total_kinetic_energy() const {
    double energy = 0.0;
    for (const auto& body : bodies_) {
        double speed_sq = body.vx * body.vx + body.vy * body.vy;
        energy += 0.5 * body.mass * speed_sq;
    }
    return energy;
}

std::size_t Grid::count_within_radius(double cx, double cy, double radius) const {
    if (radius < 0.0) {
        return 0;
    }
    const double r_sq = radius * radius;
    std::size_t matches = 0;
    for (const auto& body : bodies_) {
        double dx = body.x - cx;
        double dy = body.y - cy;
        if (dx * dx + dy * dy <= r_sq) {
            matches++;
        }
    }
    return matches;
}

void Grid::apply_impulse(std::size_t idx, double ix, double iy) {
    Body2D& body = bodies_.at(idx);
    if (body.mass <= 0.0) {
        return;
    }
    body.vx += ix / body.mass;
    body.vy += iy / body.mass;
}

} // namespace aice::physics
