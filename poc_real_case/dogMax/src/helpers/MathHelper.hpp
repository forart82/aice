#pragma once

#include <SFML/System/Vector2.hpp>

namespace dof::helpers {

float clampValue(float value, float lo, float hi);
int   clampInt(int value, int lo, int hi);

float lengthOf(sf::Vector2f vector);
float distanceBetween(sf::Vector2f a, sf::Vector2f b);
float distanceSquared(sf::Vector2f a, sf::Vector2f b);
sf::Vector2f normalizeOrZero(sf::Vector2f vector);
sf::Vector2f scaleVector(sf::Vector2f vector, float factor);

float lerp(float a, float b, float t);
sf::Vector2f lerpVector(sf::Vector2f a, sf::Vector2f b, float t);

float radiansToDegrees(float radians);
float degreesToRadians(float degrees);

// Rotate a 2D point about the origin by `radians` (screen-space, y-down).
// The linkable counterpart of the anonymous-namespace helper in
// EnemyShapeCatalog.cpp — shared so the skeletal puppet FK can reuse it.
sf::Vector2f rotate(sf::Vector2f point, float radians);

}
