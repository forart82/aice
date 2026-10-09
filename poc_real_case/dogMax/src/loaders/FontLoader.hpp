#pragma once

#include <SFML/Graphics/Font.hpp>

#include <filesystem>
#include <memory>

namespace dof::loaders {

class FontLoader {
public:
    bool loadFromFile(const std::filesystem::path& filePath);
    bool isLoaded() const;
    const sf::Font& font() const;

private:
    std::unique_ptr<sf::Font> sfmlFont;
};

}
