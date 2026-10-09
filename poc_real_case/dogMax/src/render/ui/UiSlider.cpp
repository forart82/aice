#include "render/ui/UiSlider.hpp"

#include "render/ui/PixelSnap.hpp"
#include "render/ui/UiPanel.hpp"

#include <algorithm>

namespace dof::render::ui {

namespace {
// Distance the knob centre can travel: full width minus the two half-knob
// insets that keep the knob inside `rect` at value 0 and 1.
float usableWidth(float rectW, float knobW) {
    return std::max(0.f, rectW - knobW);
}
} // namespace

sf::FloatRect UiSlider::trackRect(sf::FloatRect rect) const {
    const float y = rect.position.y + (rect.size.y - trackThickness) * 0.5f;
    return sf::FloatRect{{rect.position.x, y}, {rect.size.x, trackThickness}};
}

float UiSlider::valueAtX(sf::FloatRect rect, float x) const {
    const float usable = usableWidth(rect.size.x, knobWidth);
    if (usable <= 0.f) return 0.f;
    const float left = rect.position.x + knobWidth * 0.5f;
    return std::clamp((x - left) / usable, 0.f, 1.f);
}

sf::FloatRect UiSlider::knobRect(sf::FloatRect rect, float value) const {
    const float v = std::clamp(value, 0.f, 1.f);
    const float usable = usableWidth(rect.size.x, knobWidth);
    const float centreX = rect.position.x + knobWidth * 0.5f + v * usable;
    const float y = rect.position.y + (rect.size.y - knobHeight) * 0.5f;
    return sf::FloatRect{{centreX - knobWidth * 0.5f, y}, {knobWidth, knobHeight}};
}

bool UiSlider::hitTestKnob(sf::FloatRect rect, float value, sf::Vector2f point,
                           bool isEnabled) const {
    return isEnabled && knobRect(rect, value).contains(point);
}

bool UiSlider::hitTestTrack(sf::FloatRect rect, float value, sf::Vector2f point,
                            bool isEnabled) const {
    if (!isEnabled) return false;
    // Disjoint from the knob: where the two painted shapes overlap the grab
    // target wins, so a caller can ask both without ordering them.
    if (knobRect(rect, value).contains(point)) return false;
    return trackRect(rect).contains(point);
}

void UiSlider::draw(sf::RenderWindow& window, sf::FloatRect rect,
                    float value, bool isDragging, bool isEnabled) const {
    const sf::FloatRect tr = trackRect(rect);

    ui::drawThinQuad(window, tr, track);

    const sf::FloatRect kr = knobRect(rect, value);
    const float knobCentreX = kr.position.x + kr.size.x * 0.5f;
    const float fillW = knobCentreX - tr.position.x;
    if (fillW > 0.f) {
        ui::drawThinQuad(window, {tr.position, {fillW, tr.size.y}}, fill);
    }

    // Knob body composed from UiPanel for a crisp, pixel-snapped outline. A
    // disabled slider cannot be dragged, so the "being dragged" fill is
    // suppressed and the knob always paints idle.
    ui::UiPanel knobBody;
    knobBody.background      = (isDragging && isEnabled) ? knobDragging : knob;
    knobBody.border          = border;
    knobBody.borderThickness = borderThickness;
    knobBody.draw(window, kr);
}

} // namespace dof::render::ui
