#pragma once

#include <string_view>

namespace sf { class Image; class Texture; }

namespace dof::render {

// Copies nearby opaque RGB into fully transparent pixels while preserving
// alpha. Mipmap filtering can then sample edge colour instead of transparent
// black, preventing dark halos around sprites.
void dilateTransparentRgb(sf::Image& image, int passes);

// Final GPU state for painted world art. Call only after the last image upload;
// later texture updates invalidate the mip chain.
void prepareWorldTexture(sf::Texture& texture,
                         bool isRepeated,
                         std::string_view textureName);

} // namespace dof::render
