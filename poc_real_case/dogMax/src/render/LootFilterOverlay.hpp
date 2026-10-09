#pragma once

#include "render/LootFilterLayout.hpp"
#include "render/UiAccent.hpp"
#include "render/ui/UiChip.hpp"

#include <SFML/Graphics/Color.hpp>

#include <string>

namespace dof::hubs { struct LootFilter; }
namespace dof::loaders { class ConfigLoader; }
namespace sf { class Font; class RenderWindow; }

namespace dof::render {

// Colour palette for the loot-filter popup chrome, loaded once from
// config in the constructor so no sf::Color literal lives in the draw
// code (CLAUDE.md: tunables live in configs/loot_filter.yaml).
struct LootFilterPalette {
    sf::Color popupBg;          // dark translucent panel substrate
    sf::Color cyan;             // selected chip / focused field accent
    sf::Color chipBorder;       // unselected chip / field border
    sf::Color chipSelFill;      // selected chip / armed button body
    sf::Color chipBgFill;       // unselected chip / field body
    sf::Color textBright;       // focused input text
    sf::Color textDim;          // dim labels + unselected text
    sf::Color sectionHdr;       // section header text
    sf::Color swatchOffFill;    // inactive quality-tier swatch fill
    sf::Color swatchOffBorder;  // inactive quality-tier swatch border
    sf::Color swatchOffLabel;   // inactive quality-tier swatch label
};

// Renders the loot-filter popup: weapon-type chips, dice-face chips,
// quality/level input fields. Chip selection and focus state drive
// colour; all layout geometry comes from LootFilterLayout.
class LootFilterOverlay {
public:
    LootFilterOverlay(const dof::loaders::ConfigLoader& config, const sf::Font& font);

    void draw(sf::RenderWindow& window,
              const LootFilterLayout& layout,
              const dof::hubs::LootFilter& filter,
              bool isQualityFocused,
              bool isLevelFocused,
              const std::string& qualityInput,
              const std::string& levelInput) const;

private:
    void drawQualityTierSwatches(sf::RenderWindow& window,
                                  sf::FloatRect fieldRect,
                                  const std::string& qualityInput) const;

    const dof::loaders::ConfigLoader& configRef;
    UiAccent         accent{};
    ui::UiChip       chip{};
    const sf::Font*  fontPtr{nullptr};
    int              uncommonThreshold{40};
    int              rareThreshold{80};
    sf::Color        tierCommon;
    sf::Color        tierUncommon;
    sf::Color        tierRare;

    // Popup chrome palette + typography, loaded from config in the ctor.
    LootFilterPalette palette{};
    std::string       hintText;
    unsigned          fontChip{};         // chip labels, dice-count, UNSET
    unsigned          fontSection{};      // section headers
    unsigned          fontLabel{};        // field sublabels + close hint
    unsigned          fontInput{};        // quality/level input text
    unsigned          fontSwatchLabel{};  // C/U/R swatch letters
};

} // namespace dof::render
