#include "render/ui/UiToggle.hpp"

#include "render/ui/PixelSnap.hpp"
#include "render/ui/UiPanel.hpp"

namespace dof::render::ui {

sf::FloatRect UiToggle::boxRect(sf::FloatRect rect) const {
    const float y = rect.position.y + (rect.size.y - boxSize) * 0.5f;
    return sf::FloatRect{{rect.position.x, y}, {boxSize, boxSize}};
}

sf::FloatRect UiToggle::labelRect(sf::FloatRect rect) const {
    const float x = rect.position.x + boxSize + labelGap;
    return sf::FloatRect{{x, rect.position.y},
                         {rect.size.x - boxSize - labelGap, rect.size.y}};
}

bool UiToggle::hitTest(sf::FloatRect rect, sf::Vector2f point, bool isEnabled) const {
    return isEnabled && rect.contains(point);
}

void UiToggle::draw(sf::RenderWindow& window, sf::FloatRect rect,
                    bool isOn, bool isHover, bool isEnabled) const {
    const sf::FloatRect box = boxRect(rect);

    // A disabled toggle is inert: hover never reads back, so the off box keeps
    // its idle fill whatever the pointer does. The on/off state still shows —
    // disabled means "you cannot change this", not "you cannot see it".
    const bool showHover = isHover && isEnabled;

    // Box body composed from UiPanel so fill + outline follow the shared
    // pixel-snapped panel path.
    ui::UiPanel body;
    body.background      = isOn ? boxOn : (showHover ? boxHover : boxOff);
    body.border          = border;
    body.borderThickness = borderThickness;
    body.draw(window, box);

    // Inset check fill marks the on state; skipped if the inset would swallow
    // the whole box.
    if (isOn && checkInset * 2.f < boxSize) {
        ui::drawThinQuad(
            window,
            {{box.position.x + checkInset, box.position.y + checkInset},
             {box.size.x - checkInset * 2.f, box.size.y - checkInset * 2.f}},
            check);
    }
}

} // namespace dof::render::ui
