#include "render/UiAccent.hpp"

#include "loaders/ConfigLoader.hpp"

namespace dof::render {

UiAccent UiAccent::loadFromConfig(const dof::loaders::ConfigLoader& config) {
    UiAccent accent{};
    accent.rgb = sf::Color{
        static_cast<std::uint8_t>(config.getInt("UI_ACCENT_R")),
        static_cast<std::uint8_t>(config.getInt("UI_ACCENT_G")),
        static_cast<std::uint8_t>(config.getInt("UI_ACCENT_B"))};
    accent.alphaFull         = static_cast<std::uint8_t>(config.getInt("UI_ACCENT_ALPHA_FULL"));
    accent.alphaDim          = static_cast<std::uint8_t>(config.getInt("UI_ACCENT_ALPHA_DIM"));
    accent.thicknessOutline  = config.getFloat("UI_ACCENT_OUTLINE_THICKNESS");
    accent.thicknessHairline = config.getFloat("UI_ACCENT_OUTLINE_THICKNESS_HAIRLINE");
    return accent;
}

sf::Color UiAccent::full() const {
    return sf::Color{rgb.r, rgb.g, rgb.b, alphaFull};
}

sf::Color UiAccent::dim() const {
    return sf::Color{rgb.r, rgb.g, rgb.b, alphaDim};
}

}
