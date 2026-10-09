#include "render/ComponentShowcaseRenderer.hpp"
#include "render/ColorTheme.hpp"
#include "render/UiAccent.hpp"
#include "render/ui/PixelSnap.hpp"
#include "render/ui/UiLabel.hpp"
#include "render/ui/UiPanel.hpp"

#include <SFML/Graphics/Text.hpp>

namespace dof::render {
namespace {

void drawCenteredText(sf::RenderWindow& window,
                      const sf::Font& font,
                      sf::FloatRect rect,
                      const std::string& label,
                      unsigned fontSize,
                      sf::Color color) {
    sf::Text text(font, label, fontSize);
    text.setFillColor(color);
    ui::centerOriginOf(text);
    text.setPosition(ui::pixelSnap({rect.position.x + rect.size.x * 0.5f,
                                    rect.position.y + rect.size.y * 0.5f}));
    window.draw(text);
}

} // namespace

sf::FloatRect ComponentShowcaseRenderer::iconCardRect(sf::FloatRect content, int index) const {
    if (index < 0 || index >= kShowcaseIconCount) {
        return sf::FloatRect{{0.0f, 0.0f}, {0.0f, 0.0f}};
    }
    const float totalW = iconCardW_ * static_cast<float>(kShowcaseIconCount)
                       + iconCardGap_ * static_cast<float>(kShowcaseIconCount - 1);
    const float x = content.position.x + (content.size.x - totalW) * 0.5f
                  + static_cast<float>(index) * (iconCardW_ + iconCardGap_);
    const float y = content.position.y + (content.size.y - iconCardH_) * 0.5f + padding_;
    return ui::pixelSnap({{x, y}, {iconCardW_, iconCardH_}});
}

void ComponentShowcaseRenderer::drawIconsTab(sf::RenderWindow& window,
                                             sf::FloatRect content,
                                             const sf::Font& font) {
    const UiAccent accent = UiAccent::loadFromConfig(config_);
    const ColorTheme theme = buildColorTheme(config_);
    const sf::Color panelBg = resolvePanelBackground(config_, "SHOWCASE_PANEL_BG");

    sf::Text intro(font, iconIntro_, 13);
    intro.setFillColor(theme.uiDim);
    intro.setPosition(ui::pixelSnap({content.position.x + padding_, content.position.y + padding_}));
    window.draw(intro);

    for (int i = 0; i < kShowcaseIconCount; ++i) {
        const auto& card = iconCards_[static_cast<std::size_t>(i)];
        const sf::FloatRect cardRect = iconCardRect(content, i);
        const bool isHovered = cardRect.contains(mouseUi_);

        ui::UiPanel cardPanel;
        cardPanel.background = panelBg;
        cardPanel.border = isHovered ? accent.full() : accent.dim();
        cardPanel.borderThickness = accent.thicknessOutline;
        cardPanel.draw(window, cardRect);

        const float iconX = cardRect.position.x + (cardRect.size.x - iconBox_) * 0.5f;
        const sf::FloatRect iconRect{
            {iconX, cardRect.position.y + padding_},
            {iconBox_, iconBox_}};
        ui::UiPanel iconPanel;
        iconPanel.background = panelBg;
        iconPanel.border = isHovered ? accent.full() : accent.dim();
        iconPanel.borderThickness = accent.thicknessHairline;
        iconPanel.draw(window, iconRect);

        const sf::Color primary = isHovered ? accent.full() : theme.uiText;
        drawCenteredText(window, font, iconRect, card.icon, iconFontSize_, primary);

        const sf::FloatRect titleRect{
            {cardRect.position.x + padding_, iconRect.position.y + iconRect.size.y + 10.0f},
            {cardRect.size.x - padding_ * 2.0f, 20.0f}};
        ui::UiLabel{theme.uiText, iconTitleFontSize_, ui::TextAlign::Center}
            .draw(window, titleRect, font, card.title);

        const sf::FloatRect bodyRect{
            {cardRect.position.x + padding_, titleRect.position.y + titleRect.size.y + 4.0f},
            {cardRect.size.x - padding_ * 2.0f, 28.0f}};
        ui::UiLabel{theme.uiDim, iconBodyFontSize_, ui::TextAlign::Center}
            .draw(window, bodyRect, font, card.body);

        demosThisFrame_.push_back({cardRect, card.title, card.body});
    }
}

} // namespace dof::render
