#pragma once

#include "combat/DronDetector.hpp"
#include "render/ColorTheme.hpp"
#include "render/HealthColor.hpp"
#include "render/ShapeShaders.hpp"
#include "render/UiAccent.hpp"
#include "render/WeaponSlotLayout.hpp"
#include "render/widgets/UiDiceCell.hpp"
#include "render/widgets/UiDronCell.hpp"
#include "render/ui/UiProgressBar.hpp"

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Font.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/Texture.hpp>
#include <SFML/System/Clock.hpp>

#include <array>
#include <string>
#include <vector>

namespace dof::hubs { class WeaponSlotHub; class LuckHub; class PowderHub; }
namespace dof::combat { class DodgeSystem; }
namespace dof::entities { class Hero; }
namespace dof::loaders { class ConfigLoader; class ShaderLoader; }
namespace sf { class RenderWindow; }

namespace dof::render {

struct UiState;

// What the last render() call actually drew per weapon-slot tile. Exposed so
// callers can verify the renderer honoured "hide empty rows" and
// "cells = weapon slot count" from the real render path.
struct WeaponSlotRowRenderProbe {
    bool  wasDrawn{false};
    int   cellsDrawn{0};
    float rectX{0.0f};
    float rectY{0.0f};
    float rectW{0.0f};
    float rectH{0.0f};
};

// The bottom info bar. Draws the always-on player HUD strip: the weapon-slot
// tiles (weapon + dice + charge + dron) laid horizontally, plus the merged
// hero readouts — XP/level, health, luck, powder, and dash/dodge charges.
// Composes ui/* + widgets/* components; chrome reads the single UI accent,
// gameplay colours (HP ramp, dice/dron tiers, charged gold) are preserved.
class WeaponSlotSidebar {
public:
    WeaponSlotSidebar(const dof::loaders::ConfigLoader& config, const ColorTheme& theme, const sf::Font& font,
                      const dof::loaders::ShaderLoader* shaders = nullptr);

    void render(sf::RenderWindow& window,
                const dof::hubs::WeaponSlotHub& weaponSlotHub,
                const WeaponSlotLayout& layout,
                const UiState& uiState,
                const dof::entities::Hero& hero,
                const dof::hubs::LuckHub& luckHub,
                const dof::hubs::PowderHub& powderHub,
                const dof::combat::DodgeSystem& dodgeSystem,
                float vitalityReserveRatio);

    const std::vector<WeaponSlotRowRenderProbe>& lastRenderProbe() const { return renderProbe; }

private:
    void drawBarFrame(sf::RenderWindow& window, const WeaponSlotLayout& layout);
    void drawRow(sf::RenderWindow& window, int rowIndex,
                 const dof::hubs::WeaponSlotHub& weaponSlotHub,
                 const WeaponSlotLayout& layout, const UiState& uiState);
    void drawEmptySlot(sf::RenderWindow& window, int rowIndex,
                        const WeaponSlotLayout& layout, const UiState& uiState);

    // Merged hero readouts, one per bar sub-section.
    void drawXpReadout(sf::RenderWindow& window, sf::FloatRect area, const dof::entities::Hero& hero);
    void drawHealthReadout(sf::RenderWindow& window,
                           sf::FloatRect area,
                           const dof::entities::Hero& hero,
                           const dof::combat::DodgeSystem& dodgeSystem);
    void drawLuckReadout(sf::RenderWindow& window, sf::FloatRect area, const dof::hubs::LuckHub& luckHub);
    void drawPowderReadout(sf::RenderWindow& window, sf::FloatRect area, const dof::hubs::PowderHub& powderHub);
    void drawDashReadout(sf::RenderWindow& window, sf::FloatRect area, const dof::combat::DodgeSystem& dodgeSystem);
    void drawVitalTankReadout(sf::RenderWindow& window,
                              const WeaponSlotLayout& layout,
                              float vitalityReserveRatio);
    void drawActionButtons(sf::RenderWindow& window, const WeaponSlotLayout& layout, const UiState& uiState);
    void drawActionIcon(sf::RenderWindow& window, sf::FloatRect rect, InfoBarAction action, sf::Color color);
    void drawFutureActionIcon(sf::RenderWindow& window, sf::FloatRect rect,
                              int slotIndex, sf::Color color);
    void drawActionTooltip(sf::RenderWindow& window, const WeaponSlotLayout& layout, InfoBarAction action);
    const std::string& labelForAction(InfoBarAction action) const;
    const std::string& nameForAction(InfoBarAction action) const;

    const ColorTheme                  theme;
    const sf::Font&                   font;
    const dof::loaders::ConfigLoader& configRef;
    sf::Color                         rowBackground;
    sf::Color                         chargedOutline;
    float                             progressBarHeight;
    UiAccent                          accent{};
    HealthRamp                        healthRamp;
    bool                              glowEnabled{true};
    float                             glowSpread{10.0f};
    int                               glowLayers{5};
    float                             glowAlpha{70.0f};
    unsigned                          statLabelFontSize{11};
    unsigned                          statValueFontSize{18};
    float                             dashPipRadius{7.0f};
    float                             dashPipGap{8.0f};
    unsigned                          actionLabelFontSize{10};
    unsigned                          actionTooltipFontSize{11};
    float                             actionTooltipPaddingX{8.0f};
    float                             actionTooltipPaddingY{5.0f};
    float                             actionTooltipOffset{8.0f};
    float                             actionIconStroke{1.4f};
    float                             actionGlyphScale{1.0f};
    float                             actionPickupPulseSeconds{1.2f};
    sf::Texture                       hudFrameTexture;
    bool                              hasHudFrameTexture{false};
    int                               hudFrameAlpha{180};
    sf::Texture                       vitalityTankEmptyTexture;
    sf::Texture                       vitalityTankFluidTexture;
    sf::Clock                         dashReadyEffectClock;
    int                               previousDashChargesAvailable{-1};
    float                             dashReadyEffectRemainingSeconds{0.0f};
    std::array<std::string, kInfoBarActionCount> actionLabels{};
    std::array<std::string, kInfoBarActionCount> actionNames{};
    const dof::loaders::ShaderLoader* shadersPtr{nullptr};
    ShapeShaders                      shapeShaders;
    dof::combat::DronDetector         dronDetector;

    widgets::UiDiceCell  diceCell;
    ui::UiProgressBar    chargeBar;
    widgets::UiDronCell  dronCell;

    std::vector<WeaponSlotRowRenderProbe> renderProbe;
};

}
