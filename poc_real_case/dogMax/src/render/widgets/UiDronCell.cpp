#include "render/widgets/UiDronCell.hpp"

#include "render/ui/UiDivider.hpp"
#include "render/ui/UiLabel.hpp"

#include <SFML/Graphics/RenderWindow.hpp>
#include <SFML/Graphics/Text.hpp>

#include <sstream>

namespace dof::render::widgets {

void UiDronCell::draw(sf::RenderWindow& window,
                      sf::FloatRect zone,
                      float rowHeight,
                      const sf::Font& font,
                      const dof::combat::DronResult& dron) const {
    ui::UiDivider divider;
    divider.color     = dividerColor;
    divider.thickness = dividerThickness;
    divider.drawVertical(window, zone.position.x, zone.position.y, rowHeight);

    const float cx = zone.position.x + zone.size.x * 0.5f;
    const float cy = zone.position.y + zone.size.y * 0.5f;

    if (dron.isSilent) {
        sf::Text roll(font, "ROLLING", rollingFontSize);
        roll.setFillColor(nameColor);
        roll.setRotation(sf::degrees(90.0f));
        roll.setPosition({cx + rollingOffsetX,
                          cy - zone.size.y * rollingVerticalFactor});
        window.draw(roll);
        return;
    }

    const int mInt = static_cast<int>(dron.multiplier);
    const std::string mStr = (static_cast<float>(mInt) == dron.multiplier)
        ? std::to_string(mInt)
        : ([&]{ std::ostringstream ss; ss << dron.multiplier; return ss.str(); }());

    const sf::FloatRect multRect{
        {zone.position.x, cy - multiplierOffsetY},
        {zone.size.x, multiplierHeight}};
    ui::UiLabel{multiplierColor, multiplierFontSize, ui::TextAlign::Center}
        .draw(window, multRect, font, "x" + mStr);

    const sf::FloatRect nameRect{
        {zone.position.x, cy + nameOffsetY},
        {zone.size.x, nameHeight}};
    ui::UiLabel{nameColor, nameFontSize, ui::TextAlign::Center}
        .draw(window, nameRect, font, dron.name);
}

} // namespace dof::render::widgets
