#include "helpers/MathHelper.hpp"

#include <cmath>

namespace dof::helpers {

float clampValue(float value, float lo, float hi) {
    if (value < lo) return lo;
    if (value > hi) return hi;
    return value;
}

int clampInt(int value, int lo, int hi) {
    if (value < lo) return lo;
    if (value > hi) return hi;
    return value;
}

float lengthOf(sf::Vector2f vector) {
    return std::sqrt(vector.x * vector.x + vector.y * vector.y);
}

float distanceBetween(sf::Vector2f a, sf::Vector2f b) {
    return lengthOf(sf::Vector2f{a.x - b.x, a.y - b.y});
}

float distanceSquared(sf::Vector2f a, sf::Vector2f b) {
    const float dx = a.x - b.x;
    const float dy = a.y - b.y;
    return dx * dx + dy * dy;
}

sf::Vector2f normalizeOrZero(sf::Vector2f vector) {
    const float length = lengthOf(vector);
    if (length <= 0.0f) return sf::Vector2f{0.0f, 0.0f};
    return sf::Vector2f{vector.x / length, vector.y / length};
}

sf::Vector2f scaleVector(sf::Vector2f vector, float factor) {
    return sf::Vector2f{vector.x * factor, vector.y * factor};
}

float lerp(float a, float b, float t) {
    return a + (b - a) * t;
}

sf::Vector2f lerpVector(sf::Vector2f a, sf::Vector2f b, float t) {
    return sf::Vector2f{lerp(a.x, b.x, t), lerp(a.y, b.y, t)};
}

float radiansToDegrees(float radians) {
    return radians * (180.0f / 3.14159265358979323846f);
}

float degreesToRadians(float degrees) {
    return degrees * (3.14159265358979323846f / 180.0f);
}

sf::Vector2f rotate(sf::Vector2f point, float radians) {
    const float c = std::cos(radians);
    const float s = std::sin(radians);
    return sf::Vector2f{point.x * c - point.y * s,
                        point.x * s + point.y * c};
}

}
