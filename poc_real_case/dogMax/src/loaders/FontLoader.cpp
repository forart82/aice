#include "loaders/FontLoader.hpp"

#include <stdexcept>

namespace dof::loaders {

bool FontLoader::loadFromFile(const std::filesystem::path& filePath) {
    auto candidate = std::make_unique<sf::Font>();
    if (!candidate->openFromFile(filePath)) {
        return false;
    }
    sfmlFont = std::move(candidate);
    return true;
}

bool FontLoader::isLoaded() const {
    return static_cast<bool>(sfmlFont);
}

const sf::Font& FontLoader::font() const {
    if (!sfmlFont) throw std::runtime_error("FontLoader: font not loaded");
    return *sfmlFont;
}

}
