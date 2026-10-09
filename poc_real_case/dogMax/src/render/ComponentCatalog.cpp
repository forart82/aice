#include "render/ComponentCatalog.hpp"

#include "render/ui/UiPanel.hpp"
#include "render/ui/UiButton.hpp"
#include "render/ui/UiCell.hpp"
#include "render/ui/UiLabel.hpp"
#include "render/ui/UiList.hpp"
#include "render/ui/UiTab.hpp"
#include "render/ui/UiTooltip.hpp"
#include "render/ui/UiScrollPanel.hpp"
#include "render/ui/UiProgressBar.hpp"
#include "render/ui/UiDivider.hpp"
#include "render/ui/UiSearchField.hpp"
#include "render/ui/UiTextInput.hpp"
#include "render/ui/UiSlider.hpp"
#include "render/ui/UiToggle.hpp"
#include "render/ui/UiWindow.hpp"
#include "render/ui/UiScrim.hpp"
#include "render/widgets/UiDronCell.hpp"
#include "render/widgets/UiDiceCell.hpp"
#include "render/ui/UiChip.hpp"
#include "render/ui/UiSegmentedBar.hpp"
#include "render/ui/UiHexCell.hpp"
#include "render/ui/UiHazardStripe.hpp"
#include "render/ui/UiBarChart.hpp"
#include "render/ShapeShaders.hpp"
#include "combat/DronDetector.hpp"

#include <SFML/Graphics/RenderWindow.hpp>

#include <algorithm>

namespace dof::render {
namespace {

// No file-scope demo palette: every demo lambda reads its chrome from the
// per-frame single-accent tokens carried on ComponentDemoContext
// (ctx.accent / ctx.accentDim / ctx.panelBg / ctx.text / ctx.textDim), so the
// whole gallery collapses onto the shared electric-blue accent set. Demos that
// show a component's multi-state keep the panel-bg -> accent-dim -> accent
// brightness ladder so states stay distinguishable.
std::vector<ComponentCatalogEntry> buildEntries() {
    std::vector<ComponentCatalogEntry> e;

    e.push_back({"UiPanel",
        "UiPanel",
        "Filled rectangle with a coloured\noutline. Fields: background,\nborder, borderThickness.\ndraw(window, rect).",
        [](const ComponentDemoContext& ctx) {
            ui::UiPanel demo;
            demo.background = ctx.panelBg;
            demo.border = ctx.accent;
            demo.borderThickness = 1.5f;
            demo.draw(ctx.window, ctx.rect);
        }});

    e.push_back({"UiButton",
        "UiButton",
        "Clickable button with normal +\nhover states. Fields: bgNormal,\nbgHover, border, textNormal,\ntextHover. draw(... isHovered).",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            ui::UiButton btn;
            btn.bgNormal = ctx.panelBg;
            btn.bgHover = ctx.accentDim;
            btn.border = ctx.accent;
            btn.textNormal = ctx.text;
            btn.textHover = ctx.text;
            btn.borderThickness = 1.f;
            const float bw = inner.size.x / 2.f - 6.f;
            const float bh = 30.f;
            const float by = inner.position.y + (inner.size.y - bh) / 2.f;
            btn.draw(ctx.window, {{inner.position.x, by}, {bw, bh}}, ctx.font, "Normal", 12, false);
            btn.draw(ctx.window, {{inner.position.x + bw + 12.f, by}, {bw, bh}}, ctx.font, "Hover", 12, true);
        }});

    e.push_back({"UiCell",
        "UiCell",
        "Inventory/slot cell with empty,\noccupied and hovered states.\nFields: bgEmpty, bgOccupied,\nborder, borderHover. (hasContent,\nisHovered, isEnabled) + hitTest().",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            ui::UiCell cell;
            cell.bgEmpty = ctx.panelBg;
            cell.bgOccupied = ctx.panelBg;
            cell.border = ctx.accentDim;
            cell.borderHover = ctx.accent;
            cell.borderThickness = 1.f;
            const float side = 40.f;
            const float gap = 12.f;
            const float totalW = side * 3.f + gap * 2.f;
            const float cx = inner.position.x + (inner.size.x - totalW) / 2.f;
            const float cy = inner.position.y + (inner.size.y - side) / 2.f;
            cell.draw(ctx.window, {{cx, cy}, {side, side}}, false, false);
            cell.draw(ctx.window, {{cx + side + gap, cy}, {side, side}}, true, false);
            cell.draw(ctx.window, {{cx + (side + gap) * 2.f, cy}, {side, side}}, true, true);
        }});

    e.push_back({"UiLabel",
        "UiLabel",
        "Text aligned within a rect.\nFields: color, fontSize, align\n(Left / Center / Right).\ndraw(window, rect, font, text).",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            const float rowH = inner.size.y / 3.f;
            ui::UiLabel{ctx.textDim, 12, ui::TextAlign::Left}
                .draw(ctx.window, {{inner.position.x, inner.position.y}, {inner.size.x, rowH}}, ctx.font, "Left");
            ui::UiLabel{ctx.textDim, 12, ui::TextAlign::Center}
                .draw(ctx.window, {{inner.position.x, inner.position.y + rowH}, {inner.size.x, rowH}}, ctx.font, "Center");
            ui::UiLabel{ctx.textDim, 12, ui::TextAlign::Right}
                .draw(ctx.window, {{inner.position.x, inner.position.y + rowH * 2.f}, {inner.size.x, rowH}}, ctx.font, "Right");
        }});

    e.push_back({"UiList",
        "UiList",
        "Vertical list of rows with\nalternating backgrounds + a\nhighlighted row. Fields: bgRow,\nbgRowAlt, bgHighlight, textColor,\nrowHeight. Rows: UiListRow.",
        [](const ComponentDemoContext& ctx) {
            ui::UiList list;
            list.bgRow = ctx.panelBg;
            list.bgRowAlt = ctx.panelBg;
            list.bgHighlight = ctx.accentDim;
            list.textColor = ctx.text;
            list.rowHeight = 22.f;
            std::vector<ui::UiListRow> listRows{
                {"Row One",   sf::Color::White, false},
                {"Row Two",   sf::Color::White, true},
                {"Row Three", sf::Color::White, false},
                {"Row Four",  sf::Color::White, false},
            };
            list.draw(ctx.window, ctx.rect, ctx.font, 12, listRows);
        }});

    e.push_back({"UiTab",
        "UiTab",
        "Tab strip with inactive / hover /\nactive states. Fields: bgInactive,\nbgActive, bgHover, border,\ntextInactive, textActive. Methods:\ndraw(.., isEnabled) +\nhitTest(.., point, isEnabled).",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            ui::UiTab metaTab;
            metaTab.bgInactive = ctx.panelBg;
            metaTab.bgActive = ctx.accentDim;
            metaTab.bgHover = ctx.panelBg;
            metaTab.border = ctx.accent;
            metaTab.textInactive = ctx.textDim;
            metaTab.textActive = ctx.text;
            metaTab.borderThickness = 1.f;
            const sf::FloatRect strip{{inner.position.x, inner.position.y + (inner.size.y - 32.f) / 2.f},
                                      {inner.size.x, 32.f}};
            metaTab.draw(ctx.window, strip, ctx.font, 11, {"Tab A", "Tab B", "Tab C"}, 0, -1);
        }});

    e.push_back({"UiTooltip",
        "UiTooltip",
        "Floating panel anchored near the\nhovered element. Fields: panel,\ntitleColor, bodyColor, padding,\nmaxWidth. draw(... title, body).",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            ui::UiTooltip tip;
            tip.panel.background = ctx.panelBg;
            tip.panel.border = ctx.accent;
            tip.panel.borderThickness = 1.f;
            tip.titleColor = ctx.text;
            tip.bodyColor = ctx.textDim;
            tip.padding = 8.f;
            tip.maxWidth = inner.size.x - 12.f;
            tip.titleFontSize = 12.f;
            tip.bodyFontSize = 11.f;
            tip.lineHeight = 14.f;
            tip.draw(ctx.window, {inner.position.x + 6.f, inner.position.y + 8.f}, ctx.font,
                     "Tooltip", "Floating hover panel\nwith a title + body.", ctx.window.getView().getSize());
        }});

    e.push_back({"UiScrollPanel",
        "UiScrollPanel",
        "View-clipped scroll region with a\nproportional scrollbar. Methods:\nclampOffset, applyClipView,\ndrawScrollbar.",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            const float clipH = inner.size.y;
            const float contentH = clipH * 2.f;
            ui::UiScrollPanel::drawScrollbar(ctx.window, inner, clipH * 0.33f, contentH, 8.f, ctx.accent);
            ui::UiLabel{ctx.textDim, 11, ui::TextAlign::Left}
                .draw(ctx.window, {{inner.position.x, inner.position.y}, {inner.size.x - 14.f, 18.f}},
                      ctx.font, "view-clip + scrollbar");
        }});

    e.push_back({"UiProgressBar",
        "UiProgressBar",
        "Fill bar for health / XP / charge.\nFields: track, fill. Methods:\ndrawHorizontal(rect, progress),\ndrawVertical(rect, progress).",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            ui::UiProgressBar bar;
            bar.track = ctx.panelBg;
            bar.fill = ctx.accent;
            const float barH = 16.f;
            const float gap = 14.f;
            const float totalH = barH * 2.f + gap;
            const float bx = inner.position.x;
            const float by = inner.position.y + (inner.size.y - totalH) / 2.f;
            bar.drawHorizontal(ctx.window, {{bx, by}, {inner.size.x, barH}}, 0.35f);
            bar.drawHorizontal(ctx.window, {{bx, by + barH + gap}, {inner.size.x, barH}}, 0.75f);
        }});

    e.push_back({"UiDivider",
        "UiDivider",
        "Thin separator hairline. Fields:\ncolor, thickness. Methods:\ndrawHorizontal(x, y, width),\ndrawVertical(x, y, height).",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            ui::UiDivider divider;
            divider.color = ctx.accentDim;
            divider.thickness = 1.5f;
            const float midY = inner.position.y + inner.size.y / 2.f;
            const float midX = inner.position.x + inner.size.x / 2.f;
            divider.drawHorizontal(ctx.window, inner.position.x, midY, inner.size.x);
            divider.drawVertical(ctx.window, midX, inner.position.y, inner.size.y);
        }});

    e.push_back({"UiSearchField",
        "UiSearchField",
        "Single-line text filter with\nplaceholder + focused caret.\nFields: bgColor, borderNormal,\nborderFocused, caretColor. (query,\nisFocused).",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            ui::UiSearchField field;
            field.bgColor = ctx.panelBg;
            field.borderNormal = ctx.accentDim;
            field.borderFocused = ctx.accent;
            field.textColor = ctx.text;
            field.placeholderColor = ctx.textDim;
            field.caretColor = ctx.accent;
            field.borderThickness = 1.f;
            const float fieldH = 26.f;
            const float gap = 12.f;
            const float totalH = fieldH * 2.f + gap;
            const float fx = inner.position.x;
            const float fy = inner.position.y + (inner.size.y - totalH) / 2.f;
            field.draw(ctx.window, {{fx, fy}, {inner.size.x, fieldH}}, ctx.font, 12, "", false);
            field.draw(ctx.window, {{fx, fy + fieldH + gap}, {inner.size.x, fieldH}}, ctx.font, 12, "weapon", true);
        }});

    e.push_back({"UiDronCell",
        "UiDronCell",
        "Dron-indicator column: divider +\nmultiplier + pattern name when a\nDron fires (ROLLING otherwise).\nFields: multiplierColor, nameColor,\ndividerColor. (DronResult).",
        [](const ComponentDemoContext& ctx) {
            widgets::UiDronCell dronCell;
            dronCell.multiplierColor = ctx.accent;
            dronCell.nameColor = ctx.textDim;
            dof::combat::DronResult dron;
            dron.tier = dof::combat::DronTier::Tridron;
            dron.multiplier = 2.5f;
            dron.name = "Tridron";
            dron.isSilent = false;
            dronCell.draw(ctx.window, ctx.rect, ctx.rect.size.y, ctx.font, dron);
        }});

    e.push_back({"UiDiceCell",
        "UiDiceCell",
        "Hex dice-slot chip (empty path,\nshaders=null fallback). Fields:\nemptyFill, emptyOutline, labelColor.\n(dice, faceColor, isCharged,\nShapeShaders). hitTest() tests the\nHEX, not the square cellRect.",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            widgets::UiDiceCell diceCell;
            diceCell.emptyFill = ctx.panelBg;
            diceCell.emptyOutline = ctx.accent;
            diceCell.labelColor = ctx.textDim;
            const float side = 40.f;
            const float gap = 14.f;
            const float totalW = side * 2.f + gap;
            const float dx = inner.position.x + (inner.size.x - totalW) / 2.f;
            const float dy = inner.position.y + (inner.size.y - side) / 2.f;
            diceCell.draw(ctx.window, {{dx, dy}, {side, side}}, nullptr,
                          sf::Color{}, false, ctx.accent, ctx.font, ctx.shaders, *ctx.shapeShaders);
            diceCell.draw(ctx.window, {{dx + side + gap, dy}, {side, side}}, nullptr,
                          sf::Color{}, false, ctx.accent, ctx.font, ctx.shaders, *ctx.shapeShaders);
        }});

    // ── Newly folded PanelChromeV2 components ─────────────────────────────
    e.push_back({"UiChip",
        "UiChip",
        "Badge chip anchored on a panel's\ntop edge. Title chip (top-left) +\nstatus chip (top-right, dot).\nloadFromConfig(UIR_CHIP_*).\nrectFor(panel, style, width) /\ndraw(... dotColor). Not interactive.",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            // Mock panel inset from the top so the chip overhang stays in frame.
            const sf::FloatRect mock{{inner.position.x + 8.f, inner.position.y + inner.size.y * 0.45f},
                                     {inner.size.x - 16.f, inner.size.y * 0.4f}};
            ui::UiPanel base;
            base.background = ctx.panelBg;
            base.border = ctx.accentDim;
            base.borderThickness = 1.f;
            base.draw(ctx.window, mock);
            ui::UiChip title = ui::UiChip::loadFromConfig(ctx.config);
            title.anchor = ui::UiChip::Anchor::TopLeft;
            title.draw(ctx.window, mock, ctx.font, "TITLE", 70.f);
            ui::UiChip status = ui::UiChip::loadFromConfig(ctx.config);
            status.anchor = ui::UiChip::Anchor::TopRight;
            status.draw(ctx.window, mock, ctx.font, "OK", 54.f, ctx.accent);
        }});

    e.push_back({"UiSegmentedBar",
        "UiSegmentedBar",
        "Segmented fill bar — N cells lit\nleft-to-right by a [0,1] ratio.\nloadFromConfig(UIR_SEGMENT_*).\nlitSegmentCount(ratio, n) is a\npure static helper.",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            ui::UiSegmentedBar segbar = ui::UiSegmentedBar::loadFromConfig(ctx.config);
            const float barH = 18.f;
            const sf::FloatRect r{{inner.position.x, inner.position.y + (inner.size.y - barH) / 2.f},
                                  {inner.size.x, barH}};
            segbar.draw(ctx.window, r, 0.6f, ctx.accent, ctx.panelBg);
        }});

    e.push_back({"UiHexCell",
        "UiHexCell",
        "Pointy-top hexagon chip. Fields:\nradius, outlineThickness.\nloadFromConfig(UIR_HEX_CELL_*).\nhexCellVertices(centre, radius) is\na pure static helper; hitTest() is a\nreal point-in-hexagon, not a rect.",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            ui::UiHexCell hex = ui::UiHexCell::loadFromConfig(ctx.config);
            hex.radius = std::min(hex.radius, inner.size.y * 0.35f);
            hex.outlineThickness = 2.f;
            const float cy = inner.position.y + inner.size.y * 0.5f;
            const float step = hex.radius * 2.f + 12.f;
            const float startX = inner.position.x + inner.size.x * 0.5f - step * 0.5f;
            hex.draw(ctx.window, {startX, cy}, ctx.panelBg, ctx.accent);
            hex.draw(ctx.window, {startX + step, cy}, ctx.accentDim, ctx.text);
        }});

    e.push_back({"UiHazardStripe",
        "UiHazardStripe",
        "Diagonal hazard-stripe plate:\ndark wash + angled bars pre-clipped\nto the rect. Fields: period,\nstripeA/B, angleDegrees.\nloadFromConfig(UIR_HAZARD_*).",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            ui::UiHazardStripe stripe = ui::UiHazardStripe::loadFromConfig(ctx.config);
            const float h = std::min(inner.size.y, 40.f);
            const sf::FloatRect r{{inner.position.x, inner.position.y + (inner.size.y - h) / 2.f},
                                  {inner.size.x, h}};
            stripe.draw(ctx.window, r);
        }});

    e.push_back({"UiBarChart",
        "UiBarChart",
        "Vertical bar chart: N bars filled\nbottom-up by [0,1] heights.\nFields: fill, track, gap.\ndraw(window, rect, values). For\ncompact perf/history read-outs.",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            ui::UiBarChart chart;
            chart.fill = ctx.accent;
            chart.track = ctx.panelBg;
            chart.gap = 4.f;
            const std::vector<float> values{0.2f, 0.5f, 0.35f, 0.8f, 0.6f, 1.0f, 0.45f, 0.7f};
            const float h = std::min(inner.size.y, 60.f);
            const sf::FloatRect r{{inner.position.x, inner.position.y + (inner.size.y - h) / 2.f},
                                  {inner.size.x, h}};
            chart.draw(ctx.window, r, values);
        }});

    e.push_back({"UiTextInput",
        "UiTextInput",
        "Single-line editable text box.\nCaller owns text, caret and focus.\nIncludes caretIndexAtX() and\napplyKey() for stateless editing.",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            ui::UiTextInput input;
            input.bgColor = ctx.panelBg;
            input.borderNormal = ctx.accentDim;
            input.borderFocused = ctx.accent;
            input.textColor = ctx.text;
            input.placeholderColor = ctx.textDim;
            input.caretColor = ctx.accent;
            input.borderThickness = 1.f;
            const float fieldH = 26.f;
            const float gap = 12.f;
            const float totalH = fieldH * 2.f + gap;
            const float y = inner.position.y + (inner.size.y - totalH) * 0.5f;
            input.draw(ctx.window, {{inner.position.x, y}, {inner.size.x, fieldH}},
                       ctx.font, 12, "", false, 0, "type value");
            input.draw(ctx.window, {{inner.position.x, y + fieldH + gap}, {inner.size.x, fieldH}},
                       ctx.font, 12, "42", true, 2, "type value");
        }});

    e.push_back({"UiSlider",
        "UiSlider",
        "Horizontal slider. Caller owns\nvalue + drag state. Helpers:\nvalueAtX(), knobRect(), trackRect().\nhitTestKnob() grabs, hitTestTrack()\njumps — disjoint targets.",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            ui::UiSlider slider;
            slider.track = ctx.panelBg;
            slider.fill = ctx.accent;
            slider.knob = ctx.panelBg;
            slider.knobDragging = ctx.accentDim;
            slider.border = ctx.accent;
            const float rowH = 28.f;
            const float gap = 12.f;
            const float y = inner.position.y + (inner.size.y - (rowH * 2.f + gap)) * 0.5f;
            slider.draw(ctx.window, {{inner.position.x, y}, {inner.size.x, rowH}}, 0.35f, false);
            slider.draw(ctx.window, {{inner.position.x, y + rowH + gap}, {inner.size.x, rowH}}, 0.75f, true);
        }});

    e.push_back({"UiToggle",
        "UiToggle",
        "Checkbox-style on/off control.\nCaller draws label text and owns the\nbool. Helpers: boxRect(),\nlabelRect(), hitTest(rect, point,\nisEnabled) — whole rect is the target.",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            ui::UiToggle toggle;
            toggle.boxOff = ctx.panelBg;
            toggle.boxOn = ctx.accentDim;
            toggle.boxHover = ctx.accentDim;
            toggle.border = ctx.accent;
            toggle.check = ctx.accent;
            const float rowH = 24.f;
            const float gap = 10.f;
            const float y = inner.position.y + (inner.size.y - (rowH * 2.f + gap)) * 0.5f;
            const sf::FloatRect offRow{{inner.position.x, y}, {inner.size.x, rowH}};
            const sf::FloatRect onRow{{inner.position.x, y + rowH + gap}, {inner.size.x, rowH}};
            toggle.draw(ctx.window, offRow, false, true);
            toggle.draw(ctx.window, onRow, true, false);
            ui::UiLabel{ctx.textDim, 11, ui::TextAlign::Left}
                .draw(ctx.window, toggle.labelRect(offRow), ctx.font, "hover");
            ui::UiLabel{ctx.text, 11, ui::TextAlign::Left}
                .draw(ctx.window, toggle.labelRect(onRow), ctx.font, "enabled");
        }});

    e.push_back({"UiWindow",
        "UiWindow",
        "Composable framed window: body\npanel + title chip + contentRect().\nCaller may pair contentRect with\nUiScrollPanel for scrolling.",
        [](const ComponentDemoContext& ctx) {
            const sf::FloatRect inner = ctx.rect;
            const sf::FloatRect box{{inner.position.x + 8.f, inner.position.y + 12.f},
                                    {inner.size.x - 16.f, inner.size.y - 20.f}};
            ui::UiWindow win;
            win.panel.background = ctx.panelBg;
            win.panel.border = ctx.accent;
            win.panel.borderThickness = 1.f;
            win.titleChip = ui::UiChip::loadFromConfig(ctx.config);
            win.titleBarHeight = 24.f;
            win.contentPadding = 8.f;
            win.drawFrame(ctx.window, box, ctx.font, "WINDOW");
            ui::UiLabel{ctx.textDim, 11, ui::TextAlign::Center}
                .draw(ctx.window, win.contentRect(box, "WINDOW"), ctx.font, "contentRect()");
        }});

    e.push_back({"UiScrim",
        "UiScrim",
        "Full-bounds dim overlay for modal\nwindows. Caller supplies the RGBA\ncolour; draw() is a single filled rect.",
        [](const ComponentDemoContext& ctx) {
            ui::UiPanel base;
            base.background = ctx.panelBg;
            base.border = ctx.accentDim;
            base.borderThickness = 1.f;
            base.draw(ctx.window, ctx.rect);
            ui::UiScrim scrim;
            scrim.color = sf::Color{0, 0, 0, 130};
            scrim.draw(ctx.window, ctx.rect);
            ui::UiLabel{ctx.text, 12, ui::TextAlign::Center}
                .draw(ctx.window, ctx.rect, ctx.font, "modal dim");
        }});

    return e;
}

} // namespace

const std::vector<ComponentCatalogEntry>& componentCatalogEntries() {
    static const std::vector<ComponentCatalogEntry> kEntries = buildEntries();
    return kEntries;
}

} // namespace dof::render
