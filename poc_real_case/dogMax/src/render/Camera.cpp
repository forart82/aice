#include "render/Camera.hpp"

#include "loaders/ConfigLoader.hpp"

#include <algorithm>
#include <cmath>

namespace dof::render {

Camera::Camera(const dof::loaders::ConfigLoader& config)
    : designDimensions{static_cast<unsigned>(config.getInt("GLOBAL_SCREEN_WIDTH")),
                       static_cast<unsigned>(config.getInt("GLOBAL_SCREEN_HEIGHT"))} {
    zoomValue = config.getFloat("CAMERA_ZOOM_DEFAULT");
    minZoom   = config.getFloat("CAMERA_ZOOM_MIN");
    maxZoom   = config.getFloat("CAMERA_ZOOM_MAX");
    followVisualOffsetY = config.getFloat("CAMERA_FOLLOW_VISUAL_OFFSET_Y");
    isShakeEnabled       = config.getInt("CAMERA_SHAKE_ENABLE") != 0;
    shakeMaxOffsetPixels = config.getFloat("CAMERA_SHAKE_MAX_OFFSET_PIXELS");
    shakeFrequencyHz     = config.getFloat("CAMERA_SHAKE_FREQUENCY_HZ");
    shakeDecayPerSecond  = config.getFloat("CAMERA_SHAKE_DECAY_PER_SECOND");
    shakeTraumaCeiling   = config.getFloat("CAMERA_SHAKE_TRAUMA_CEILING");
    shakeFrequencyRatioY = config.getFloat("CAMERA_SHAKE_FREQUENCY_RATIO_Y");
    shakePhaseOffsetY    = config.getFloat("CAMERA_SHAKE_PHASE_OFFSET_Y");
}

void Camera::followTarget(sf::Vector2f targetPosition) {
    // Painted, mipmapped world art needs continuous camera motion. Pixel
    // snapping is reserved for the separate UI pass; snapping the world view
    // creates visible one-pixel steps and unstable sampling at arbitrary zoom.
    focus = {targetPosition.x, targetPosition.y + followVisualOffsetY};
}

void Camera::setFocus(sf::Vector2f focusPosition) {
    focus = focusPosition;
}

void Camera::zoomBy(float factor) {
    if (factor <= 0.0f) return;
    setZoom(zoomValue * factor);
}

void Camera::zoomBy(float factor, float minimumZoom, float maximumZoom) {
    if (factor <= 0.0f || minimumZoom <= 0.0f || maximumZoom < minimumZoom) return;
    const float zoom = zoomValue * factor;
    if (!std::isfinite(zoom) || zoom <= 0.0f) return;
    zoomValue = std::clamp(zoom, minimumZoom, maximumZoom);
}

void Camera::setZoom(float zoom) {
    if (!std::isfinite(zoom) || zoom <= 0.0f) return;
    zoomValue = std::clamp(zoom, minZoom, maxZoom);
}

void Camera::addShakeTrauma(float amount) {
    if (!isShakeEnabled || amount <= 0.0f) return;
    // Clamped on accumulation, which is the cap the swarm case needs: many
    // hits in one frame can only ever reach the ceiling, never exceed it.
    shakeTrauma = std::min(shakeTrauma + amount, shakeTraumaCeiling);
}

void Camera::advanceShake(float dt) {
    if (dt <= 0.0f) return;
    shakeTimeSeconds += dt;
    shakeTrauma = std::max(0.0f, shakeTrauma - shakeDecayPerSecond * dt);
}

sf::Vector2f Camera::shakeOffsetWorld(float zoom) const {
    if (!isShakeEnabled || shakeTrauma <= 0.0f) return {0.0f, 0.0f};
    // Amplitude is trauma SQUARED so small hits barely register while a burst
    // of damage lands hard — a linear ramp makes every trivial hit shake the
    // screen, which reads as noise rather than impact.
    const float amplitude = shakeMaxOffsetPixels * shakeTrauma * shakeTrauma;
    const float angular = 2.0f * 3.14159265358979323846f * shakeFrequencyHz
                        * shakeTimeSeconds;
    // Two incommensurate frequencies, so the path never settles into a
    // repeating ellipse the eye can lock onto. Deterministic — no RNG, so a
    // replay of the same seed shakes identically.
    const sf::Vector2f pixels{
        amplitude * std::sin(angular),
        amplitude * std::sin(angular * shakeFrequencyRatioY + shakePhaseOffsetY)};
    // View size is design/zoom, so one design pixel is 1/zoom world units.
    // Without this divide the shake would grow as the player zooms out.
    return {pixels.x / zoom, pixels.y / zoom};
}

sf::View Camera::activeView() const {
    const float baseWidth  = static_cast<float>(designDimensions.x);
    const float baseHeight = static_cast<float>(designDimensions.y);
    // Guard against invalid configuration producing an inf/nan view rect.
    const float z = (zoomValue > 0.0f) ? zoomValue : 1.0f;
    const sf::Vector2f shaken = focus + shakeOffsetWorld(z);
    sf::View view(sf::FloatRect{{-baseWidth / 2.0f / z + shaken.x,
                                  -baseHeight / 2.0f / z + shaken.y},
                                {baseWidth / z, baseHeight / z}});
    // Same shaken centre as the rect above — passing the unshaken focus here
    // would silently undo the offset.
    view.setCenter(shaken);
    return view;
}

float Camera::currentZoom() const { return zoomValue; }
sf::Vector2f Camera::focusPosition() const { return focus; }
sf::Vector2u Camera::designSize() const   { return designDimensions; }

}
