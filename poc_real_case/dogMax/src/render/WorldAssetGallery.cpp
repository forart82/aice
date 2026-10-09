#include "render/WorldAssetGallery.hpp"

#include "loaders/ConfigLoader.hpp"

#include <SFML/Graphics/Image.hpp>
#include <SFML/Graphics/RectangleShape.hpp>
#include <SFML/Graphics/RenderTarget.hpp>
#include <SFML/Graphics/Sprite.hpp>
#include <SFML/Graphics/Text.hpp>
#include <SFML/Graphics/Texture.hpp>
#include <SFML/Window/Keyboard.hpp>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <iterator>
#include <string_view>
#include <system_error>

namespace dof::render {

namespace {

sf::Color byteColor(const dof::loaders::ConfigLoader& config,
                    const std::string& prefix) {
    return {
        static_cast<std::uint8_t>(config.getInt(prefix + "_R")),
        static_cast<std::uint8_t>(config.getInt(prefix + "_G")),
        static_cast<std::uint8_t>(config.getInt(prefix + "_B")),
        static_cast<std::uint8_t>(config.getInt(prefix + "_A"))};
}

bool isSupportedImage(const std::filesystem::path& path) {
    std::string extension = path.extension().string();
    std::transform(extension.begin(), extension.end(), extension.begin(),
        [](unsigned char value) { return static_cast<char>(std::tolower(value)); });
    return extension == ".png" || extension == ".jpg" || extension == ".jpeg"
        || extension == ".bmp" || extension == ".tga";
}

std::string lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(),
        [](unsigned char character) { return static_cast<char>(std::tolower(character)); });
    return value;
}

std::string folderKey(const std::filesystem::path& relativePath) {
    if (relativePath.empty() || relativePath == ".") return {};
    return relativePath.generic_string();
}

bool isInsideFolder(const std::filesystem::path& folder,
                    const std::filesystem::path& candidate) {
    auto folderPart = folder.begin();
    auto candidatePart = candidate.begin();
    for (; folderPart != folder.end(); ++folderPart, ++candidatePart) {
        if (candidatePart == candidate.end() || *folderPart != *candidatePart) {
            return false;
        }
    }
    return true;
}

bool isGreenChromaPixel(sf::Color pixel, int greenMinimum, int dominanceMinimum) {
    const int strongestOther = std::max(static_cast<int>(pixel.r),
                                        static_cast<int>(pixel.b));
    return static_cast<int>(pixel.g) >= greenMinimum
        && static_cast<int>(pixel.g) - strongestOther >= dominanceMinimum;
}

void removeCornerGreenChroma(sf::Image& image, int greenMinimum,
                             int dominanceMinimum) {
    const auto size = image.getSize();
    if (size.x == 0u || size.y == 0u) return;
    const sf::Vector2u corners[4]{{0u, 0u}, {size.x - 1u, 0u},
                                 {0u, size.y - 1u}, {size.x - 1u, size.y - 1u}};
    const int chromaCorners = static_cast<int>(std::count_if(
        std::begin(corners), std::end(corners), [&](sf::Vector2u point) {
            return isGreenChromaPixel(image.getPixel(point), greenMinimum,
                                      dominanceMinimum);
        }));
    if (chromaCorners < 3) return;
    for (unsigned y = 0; y < size.y; ++y) {
        for (unsigned x = 0; x < size.x; ++x) {
            auto pixel = image.getPixel({x, y});
            if (isGreenChromaPixel(pixel, greenMinimum, dominanceMinimum)) pixel.a = 0u;
            image.setPixel({x, y}, pixel);
        }
    }
}

void appendShortened(std::string& output, std::string_view value,
                     std::size_t maximum) {
    if (value.size() <= maximum) { output.append(value); return; }
    if (maximum <= 3u) { output.append(value.substr(0u, maximum)); return; }
    output.append(value.substr(0u, maximum - 3u));
    output.append("...");
}

void drawText(sf::RenderTarget& target, const sf::Font& font,
              const std::string& value, sf::Vector2f position,
              float size, sf::Color color) {
    sf::Text text(font, value, static_cast<unsigned>(size));
    text.setPosition(position);
    text.setFillColor(color);
    target.draw(text);
}

}

WorldAssetGallery::WorldAssetGallery(const dof::loaders::ConfigLoader& config,
                                     const sf::Font& font)
    : configRef(config), fontRef(font) {
    largeWidth = config.getFloat("WORLD_EDITOR_GALLERY_LARGE_WIDTH");
    largeHeight = config.getFloat("WORLD_EDITOR_GALLERY_LARGE_HEIGHT");
    largeX = config.getFloat("WORLD_EDITOR_GALLERY_LARGE_X");
    largeY = config.getFloat("WORLD_EDITOR_GALLERY_LARGE_Y");
    smallWidth = config.getFloat("WORLD_EDITOR_GALLERY_SMALL_WIDTH");
    smallHeight = config.getFloat("WORLD_EDITOR_GALLERY_SMALL_HEIGHT");
    smallX = config.getFloat("WORLD_EDITOR_GALLERY_SMALL_X");
    smallY = config.getFloat("WORLD_EDITOR_GALLERY_SMALL_Y");
    padding = config.getFloat("WORLD_EDITOR_GALLERY_PADDING");
    titleBarHeight = config.getFloat("WORLD_EDITOR_GALLERY_TITLE_BAR_HEIGHT");
    searchHeight = config.getFloat("WORLD_EDITOR_GALLERY_SEARCH_HEIGHT");
    folderTreeWidth = config.getFloat("WORLD_EDITOR_GALLERY_FOLDER_TREE_WIDTH");
    folderRowHeight = config.getFloat("WORLD_EDITOR_GALLERY_FOLDER_ROW_HEIGHT");
    folderIndent = config.getFloat("WORLD_EDITOR_GALLERY_FOLDER_INDENT");
    cellWidth = config.getFloat("WORLD_EDITOR_GALLERY_CELL_WIDTH");
    cellHeight = config.getFloat("WORLD_EDITOR_GALLERY_CELL_HEIGHT");
    cellGap = config.getFloat("WORLD_EDITOR_GALLERY_CELL_GAP");
    thumbnailPadding = config.getFloat("WORLD_EDITOR_GALLERY_THUMBNAIL_PADDING");
    labelFontSize = config.getFloat("WORLD_EDITOR_GALLERY_LABEL_FONT_SIZE");
    titleFontSize = config.getFloat("WORLD_EDITOR_GALLERY_TITLE_FONT_SIZE");
    buttonWidth = config.getFloat("WORLD_EDITOR_GALLERY_BUTTON_WIDTH");
    buttonHeight = config.getFloat("WORLD_EDITOR_GALLERY_BUTTON_HEIGHT");
    backgroundColor = byteColor(config, "WORLD_EDITOR_GALLERY_BACKGROUND_COLOR");
    cellColor = byteColor(config, "WORLD_EDITOR_GALLERY_CELL_COLOR");
    folderColor = byteColor(config, "WORLD_EDITOR_GALLERY_FOLDER_COLOR");
    selectedColor = byteColor(config, "WORLD_EDITOR_SELECTED_COLOR");
    outlineColor = byteColor(config, "WORLD_EDITOR_GALLERY_OUTLINE_COLOR");
    textColor = byteColor(config, "WORLD_EDITOR_GALLERY_TEXT_COLOR");
    dimColor = byteColor(config, "WORLD_EDITOR_GALLERY_DIM_COLOR");
    chromaGreenMinimum = config.getInt("WORLD_EDITOR_CHROMA_GREEN_MIN");
    chromaDominanceMinimum = config.getInt("WORLD_EDITOR_CHROMA_DOMINANCE_MIN");
    modeValue = config.getInt("WORLD_EDITOR_GALLERY_START_LARGE") != 0
        ? WorldAssetGalleryMode::Large : WorldAssetGalleryMode::Small;

    std::error_code error;
    const auto workingAssets = std::filesystem::absolute("assets", error);
    if (!error && std::filesystem::is_directory(workingAssets)) {
        assetRoot = std::filesystem::weakly_canonical(workingAssets, error);
    } else {
        const auto configDirectory = config.overridesFilePath().parent_path();
        assetRoot = std::filesystem::weakly_canonical(
            configDirectory.parent_path() / "assets", error);
    }
    currentDirectory = assetRoot / config.getString("WORLD_EDITOR_GALLERY_START_FOLDER");
    refresh();
}

void WorldAssetGallery::refresh() {
    thumbnails.clear();
    failedThumbnails.clear();
    rebuildIndex();
    rebuildVisibleAssets();
}

void WorldAssetGallery::rebuildIndex() {
    allAssets.clear();
    folders.clear();
    std::error_code error;
    if (!std::filesystem::is_directory(assetRoot)) {
        statusValue = "Asset folder unavailable";
        return;
    }
    folders.push_back({assetRoot, {}, 0, std::nullopt, 0u, false});
    const auto options = std::filesystem::directory_options::skip_permission_denied;
    for (std::filesystem::recursive_directory_iterator iterator(assetRoot, options, error), end;
         !error && iterator != end; iterator.increment(error)) {
        const auto& item = *iterator;
        if (item.is_directory(error)) {
            const auto relative = std::filesystem::relative(item.path(), assetRoot, error);
            if (error) break;
            folders.push_back({
                item.path(), relative,
                static_cast<int>(std::distance(relative.begin(), relative.end())),
                std::nullopt, 0u, false});
            continue;
        }
        if (error || !item.is_regular_file(error) || !isSupportedImage(item.path())) continue;
        const auto relative = std::filesystem::relative(item.path(), assetRoot, error);
        if (error) break;
        AssetRecord asset;
        asset.name = item.path().filename().string();
        asset.absolutePath = item.path();
        asset.relativeFolder = relative.parent_path();
        asset.assetPath = (std::filesystem::path{"assets"} / relative).generic_string();
        allAssets.push_back(std::move(asset));
    }
    std::sort(folders.begin() + std::min<std::size_t>(1u, folders.size()), folders.end(),
        [](const FolderRecord& left, const FolderRecord& right) {
            return left.relativePath.generic_string() < right.relativePath.generic_string();
        });
    std::sort(allAssets.begin(), allAssets.end(), [](const AssetRecord& left,
                                                     const AssetRecord& right) {
        return left.assetPath < right.assetPath;
    });

    std::unordered_map<std::string, std::size_t> folderIndices;
    for (std::size_t index = 0; index < folders.size(); ++index) {
        folderIndices.emplace(folderKey(folders[index].relativePath), index);
    }
    for (std::size_t index = 1; index < folders.size(); ++index) {
        const auto parent = folderIndices.find(
            folderKey(folders[index].relativePath.parent_path()));
        if (parent == folderIndices.end()) continue;
        folders[index].parentIndex = parent->second;
        folders[parent->second].hasChildren = true;
    }
    for (const auto& asset : allAssets) {
        auto folder = folderIndices.find(folderKey(asset.relativeFolder));
        while (folder != folderIndices.end()) {
            auto& record = folders[folder->second];
            ++record.descendantImageCount;
            if (!record.parentIndex.has_value()) break;
            folder = folderIndices.find(
                folderKey(folders[*record.parentIndex].relativePath));
        }
    }
    for (auto& folder : folders) folder.hasChildren = false;
    for (std::size_t index = 1; index < folders.size(); ++index) {
        if (folders[index].descendantImageCount == 0
            || !folders[index].parentIndex.has_value()) {
            continue;
        }
        folders[*folders[index].parentIndex].hasChildren = true;
    }

    std::error_code currentDirectoryError;
    if (!std::filesystem::is_directory(currentDirectory, currentDirectoryError)
        || currentDirectoryError) {
        currentDirectory = assetRoot;
    } else {
        currentDirectory = std::filesystem::weakly_canonical(
            currentDirectory, currentDirectoryError);
        if (currentDirectoryError) currentDirectory = assetRoot;
    }
    if (!isFolderExpansionInitialized) {
        for (const auto& folder : folders) {
            if (folder.hasChildren) {
                collapsedFolderPaths.insert(folderKey(folder.relativePath));
            }
        }
        std::error_code relativeError;
        auto currentRelative = std::filesystem::relative(
            currentDirectory, assetRoot, relativeError);
        if (!relativeError) {
            while (true) {
                collapsedFolderPaths.erase(folderKey(currentRelative));
                if (currentRelative.empty() || currentRelative == ".") break;
                currentRelative = currentRelative.parent_path();
            }
        }
        isFolderExpansionInitialized = true;
    } else {
        std::unordered_set<std::string> existingFolders;
        for (const auto& folder : folders) {
            if (folder.hasChildren) {
                existingFolders.insert(folderKey(folder.relativePath));
            }
        }
        std::erase_if(collapsedFolderPaths, [&](const std::string& path) {
            return !existingFolders.contains(path);
        });
    }
    rebuildVisibleFolders();
    statusValue = error ? "Asset index incomplete" : std::to_string(allAssets.size())
        + " images in " + std::to_string(folders.size()) + " folders";
}

void WorldAssetGallery::rebuildVisibleFolders() {
    visibleFolderIndices.clear();
    for (std::size_t index = 0; index < folders.size(); ++index) {
        if (folders[index].descendantImageCount == 0) continue;
        bool isVisible = true;
        auto parent = folders[index].parentIndex;
        while (parent.has_value()) {
            if (collapsedFolderPaths.contains(folderKey(folders[*parent].relativePath))) {
                isVisible = false;
                break;
            }
            parent = folders[*parent].parentIndex;
        }
        if (isVisible) visibleFolderIndices.push_back(index);
    }
    const sf::Vector2u uiSize{
        static_cast<unsigned>(configRef.getInt("UI_DESIGN_WIDTH")),
        static_cast<unsigned>(configRef.getInt("UI_DESIGN_HEIGHT"))};
    const sf::FloatRect largeBounds{
        {largeX, largeY},
        {std::min(largeWidth, static_cast<float>(uiSize.x) - largeX * 2.0f),
         std::min(largeHeight, static_cast<float>(uiSize.y) - largeY * 2.0f)}};
    folderScrollRow = std::clamp(
        folderScrollRow, 0, maximumFolderScrollRow(largeBounds));
}

void WorldAssetGallery::rebuildVisibleAssets() {
    visibleAssets.clear();
    assetPage = 0;
    pageInput.clear();
    isPageFieldFocusedValue = false;
    if (modeValue == WorldAssetGalleryMode::Small) {
        for (const auto& path : recentAssetPaths) {
            if (const auto* asset = findAsset(path)) visibleAssets.push_back(*asset);
        }
        return;
    }
    const std::string query = lower(searchQuery);
    const auto currentRelative = std::filesystem::relative(currentDirectory, assetRoot);
    for (const auto& asset : allAssets) {
        if (!query.empty()) {
            if (lower(asset.assetPath).find(query) != std::string::npos) {
                visibleAssets.push_back(asset);
            }
        } else if (currentRelative.empty() || currentRelative == "."
                   || isInsideFolder(currentRelative, asset.relativeFolder)) {
            visibleAssets.push_back(asset);
        }
    }
}

void WorldAssetGallery::toggleMode() {
    modeValue = modeValue == WorldAssetGalleryMode::Large
        ? WorldAssetGalleryMode::Small : WorldAssetGalleryMode::Large;
    isSearchFocusedValue = false;
    isPageFieldFocusedValue = false;
    rebuildVisibleAssets();
}

sf::FloatRect WorldAssetGallery::windowRect(sf::Vector2u uiSize) const {
    if (modeValue == WorldAssetGalleryMode::Large) {
        return {{largeX, largeY},
                {std::min(largeWidth, static_cast<float>(uiSize.x) - largeX * 2.0f),
                 std::min(largeHeight, static_cast<float>(uiSize.y) - largeY * 2.0f)}};
    }
    return {{smallX, smallY},
            {std::min(smallWidth, static_cast<float>(uiSize.x) - smallX * 2.0f), smallHeight}};
}

sf::FloatRect WorldAssetGallery::modeButtonRect(const sf::FloatRect& bounds) const {
    return {{bounds.position.x + bounds.size.x - padding - buttonWidth,
             bounds.position.y + padding}, {buttonWidth, buttonHeight}};
}

sf::FloatRect WorldAssetGallery::refreshButtonRect(const sf::FloatRect& bounds) const {
    return {{bounds.position.x + bounds.size.x - padding * 2.0f - buttonWidth * 2.0f,
             bounds.position.y + padding}, {buttonWidth, buttonHeight}};
}

sf::FloatRect WorldAssetGallery::searchRect(const sf::FloatRect& bounds) const {
    return {{bounds.position.x + padding, bounds.position.y + titleBarHeight},
            {bounds.size.x - padding * 2.0f, searchHeight}};
}

sf::FloatRect WorldAssetGallery::folderTreeRect(const sf::FloatRect& bounds) const {
    const auto search = searchRect(bounds);
    return {{bounds.position.x + padding, search.position.y + search.size.y + padding},
            {folderTreeWidth, bounds.size.y - titleBarHeight - searchHeight - padding * 3.0f}};
}

sf::FloatRect WorldAssetGallery::assetGridRect(const sf::FloatRect& bounds) const {
    if (modeValue == WorldAssetGalleryMode::Small) {
        return {{bounds.position.x + padding, bounds.position.y + titleBarHeight},
                {bounds.size.x - padding * 2.0f,
                 bounds.size.y - titleBarHeight - padding}};
    }
    const auto tree = folderTreeRect(bounds);
    return {{tree.position.x + tree.size.x + padding, tree.position.y},
            {bounds.size.x - tree.size.x - padding * 3.0f,
             std::max(1.0f, tree.size.y - buttonHeight - padding)}};
}

sf::FloatRect WorldAssetGallery::paginationRect(const sf::FloatRect& bounds) const {
    const auto grid = assetGridRect(bounds);
    return {{grid.position.x, grid.position.y + grid.size.y + padding},
            {grid.size.x, buttonHeight}};
}

sf::FloatRect WorldAssetGallery::nextPageRect(const sf::FloatRect& bounds) const {
    const auto pagination = paginationRect(bounds);
    return {{pagination.position.x + pagination.size.x - buttonHeight,
             pagination.position.y},
            {buttonHeight, pagination.size.y}};
}

sf::FloatRect WorldAssetGallery::pageFieldRect(const sf::FloatRect& bounds) const {
    const auto next = nextPageRect(bounds);
    return {{next.position.x - cellGap - buttonWidth, next.position.y},
            {buttonWidth, next.size.y}};
}

sf::FloatRect WorldAssetGallery::previousPageRect(const sf::FloatRect& bounds) const {
    const auto field = pageFieldRect(bounds);
    return {{field.position.x - cellGap - buttonHeight, field.position.y},
            {buttonHeight, field.size.y}};
}

int WorldAssetGallery::assetColumnCount(const sf::FloatRect& bounds) const {
    return std::max(1, static_cast<int>(std::floor((assetGridRect(bounds).size.x + cellGap)
        / std::max(1.0f, cellWidth + cellGap))));
}

float WorldAssetGallery::assetCellHeight(const sf::FloatRect& bounds) const {
    return std::max(1.0f, std::min(cellHeight, assetGridRect(bounds).size.y));
}

int WorldAssetGallery::visibleAssetRows(const sf::FloatRect& bounds) const {
    return std::max(1, static_cast<int>(std::floor((assetGridRect(bounds).size.y + cellGap)
        / std::max(1.0f, assetCellHeight(bounds) + cellGap))));
}

int WorldAssetGallery::assetPageSize(const sf::FloatRect& bounds) const {
    return std::max(1, assetColumnCount(bounds) * visibleAssetRows(bounds));
}

int WorldAssetGallery::assetPageCount(const sf::FloatRect& bounds) const {
    const auto pageSize = static_cast<std::size_t>(assetPageSize(bounds));
    return std::max(1, static_cast<int>(
        (visibleAssets.size() + pageSize - 1u) / pageSize));
}

int WorldAssetGallery::maximumFolderScrollRow(const sf::FloatRect& bounds) const {
    const int visibleRows = std::max(1, static_cast<int>(
        std::floor(folderTreeRect(bounds).size.y / std::max(1.0f, folderRowHeight))));
    return std::max(
        0, static_cast<int>(visibleFolderIndices.size()) - visibleRows);
}

std::optional<std::size_t> WorldAssetGallery::folderAt(
    sf::Vector2f uiPosition, const sf::FloatRect& bounds) const {
    const auto tree = folderTreeRect(bounds);
    if (!tree.contains(uiPosition)) return std::nullopt;
    const int row = static_cast<int>((uiPosition.y - tree.position.y) / folderRowHeight);
    const std::size_t index = static_cast<std::size_t>(row + folderScrollRow);
    return index < visibleFolderIndices.size()
        ? std::optional<std::size_t>{visibleFolderIndices[index]}
        : std::nullopt;
}

std::optional<std::size_t> WorldAssetGallery::assetAt(
    sf::Vector2f uiPosition, const sf::FloatRect& bounds) const {
    const auto grid = assetGridRect(bounds);
    if (!grid.contains(uiPosition)) return std::nullopt;
    const int column = static_cast<int>((uiPosition.x - grid.position.x) / (cellWidth + cellGap));
    const float displayedCellHeight = assetCellHeight(bounds);
    const int row = static_cast<int>((uiPosition.y - grid.position.y)
                                     / (displayedCellHeight + cellGap));
    if (column < 0 || column >= assetColumnCount(bounds) || row < 0) return std::nullopt;
    const float localX = std::fmod(uiPosition.x - grid.position.x, cellWidth + cellGap);
    const float localY = std::fmod(uiPosition.y - grid.position.y,
                                  displayedCellHeight + cellGap);
    if (localX > cellWidth || localY > displayedCellHeight) return std::nullopt;
    const std::size_t index = static_cast<std::size_t>(
        assetPage * assetPageSize(bounds)
        + row * assetColumnCount(bounds) + column);
    return index < visibleAssets.size() ? std::optional<std::size_t>{index} : std::nullopt;
}

bool WorldAssetGallery::isFolderToggleAt(
    sf::Vector2f uiPosition, const sf::FloatRect& bounds,
    std::size_t folderIndex) const {
    if (folderIndex >= folders.size() || !folders[folderIndex].hasChildren) {
        return false;
    }
    const auto tree = folderTreeRect(bounds);
    const float toggleX = tree.position.x + 6.0f
        + static_cast<float>(folders[folderIndex].depth) * folderIndent;
    return uiPosition.x >= toggleX
        && uiPosition.x <= toggleX + folderIndent;
}

void WorldAssetGallery::toggleFolder(std::size_t folderIndex) {
    if (folderIndex >= folders.size() || !folders[folderIndex].hasChildren) return;
    const std::string key = folderKey(folders[folderIndex].relativePath);
    const bool wasCollapsed = collapsedFolderPaths.contains(key);
    if (wasCollapsed) collapsedFolderPaths.erase(key);
    else collapsedFolderPaths.insert(key);
    rebuildVisibleFolders();
    const std::string name = folders[folderIndex].relativePath.empty()
        ? "assets" : folders[folderIndex].relativePath.filename().string();
    statusValue = name + (wasCollapsed ? " expanded" : " collapsed");
}

void WorldAssetGallery::selectAssetPage(
    int page, const sf::FloatRect& bounds) {
    assetPage = std::clamp(page, 0, assetPageCount(bounds) - 1);
    pageInput.clear();
    isPageFieldFocusedValue = false;
    statusValue = "Page " + std::to_string(assetPage + 1) + " of "
        + std::to_string(assetPageCount(bounds));
}

void WorldAssetGallery::commitPageInput(const sf::FloatRect& bounds) {
    if (!isPageFieldFocusedValue) return;
    if (pageInput.empty()) {
        isPageFieldFocusedValue = false;
        return;
    }
    int requestedPage = 0;
    for (const char digit : pageInput) {
        requestedPage = std::min(1'000'000,
            requestedPage * 10 + static_cast<int>(digit - '0'));
    }
    selectAssetPage(requestedPage - 1, bounds);
}

WorldAssetGalleryPress WorldAssetGallery::handlePress(sf::Vector2f uiPosition,
                                                       sf::Vector2u uiSize) {
    const auto bounds = windowRect(uiSize);
    if (isPageFieldFocusedValue
        && !pageFieldRect(bounds).contains(uiPosition)) {
        commitPageInput(bounds);
    }
    if (!bounds.contains(uiPosition)) {
        isSearchFocusedValue = false;
        return {};
    }
    if (modeButtonRect(bounds).contains(uiPosition)) {
        toggleMode();
        return {true, std::nullopt};
    }
    if (refreshButtonRect(bounds).contains(uiPosition)) {
        refresh();
        return {true, std::nullopt};
    }
    if (modeValue == WorldAssetGalleryMode::Large
        && searchRect(bounds).contains(uiPosition)) {
        isSearchFocusedValue = true;
        isPageFieldFocusedValue = false;
        return {true, std::nullopt};
    }
    isSearchFocusedValue = false;
    if (modeValue == WorldAssetGalleryMode::Large) {
        if (previousPageRect(bounds).contains(uiPosition)) {
            selectAssetPage(assetPage - 1, bounds);
            return {true, std::nullopt};
        }
        if (pageFieldRect(bounds).contains(uiPosition)) {
            isPageFieldFocusedValue = true;
            pageInput.clear();
            statusValue = "Type a page number, then press Enter";
            return {true, std::nullopt};
        }
        if (nextPageRect(bounds).contains(uiPosition)) {
            selectAssetPage(assetPage + 1, bounds);
            return {true, std::nullopt};
        }
        if (const auto folder = folderAt(uiPosition, bounds)) {
            if (isFolderToggleAt(uiPosition, bounds, *folder)) {
                toggleFolder(*folder);
                folderScrollRow = std::clamp(
                    folderScrollRow, 0, maximumFolderScrollRow(bounds));
                return {true, std::nullopt};
            }
            selectFolder(folders[*folder].absolutePath);
            return {true, std::nullopt};
        }
    }
    if (const auto asset = assetAt(uiPosition, bounds)) {
        statusValue = "Selected " + visibleAssets[*asset].name;
        return {true, visibleAssets[*asset].assetPath};
    }
    return {true, std::nullopt};
}

bool WorldAssetGallery::handleWheel(float delta, sf::Vector2f uiPosition,
                                    sf::Vector2u uiSize) {
    const auto bounds = windowRect(uiSize);
    if (!bounds.contains(uiPosition)) return false;
    const int direction = delta > 0.0f ? -1 : 1;
    if (modeValue == WorldAssetGalleryMode::Large
        && folderTreeRect(bounds).contains(uiPosition)) {
        folderScrollRow = std::clamp(folderScrollRow + direction,
                                     0, maximumFolderScrollRow(bounds));
    } else if (modeValue == WorldAssetGalleryMode::Large
               && (assetGridRect(bounds).contains(uiPosition)
                   || paginationRect(bounds).contains(uiPosition))) {
        selectAssetPage(assetPage + direction, bounds);
    }
    return true;
}

void WorldAssetGallery::handleTextEntered(char32_t unicode) {
    if (modeValue != WorldAssetGalleryMode::Large) return;
    if (isPageFieldFocusedValue) {
        if (unicode >= U'0' && unicode <= U'9' && pageInput.size() < 6u) {
            pageInput += static_cast<char>(unicode);
        }
    } else if (isSearchFocusedValue && unicode >= 0x20 && unicode < 0x7f) {
        searchQuery += static_cast<char>(unicode);
        rebuildVisibleAssets();
    }
}

bool WorldAssetGallery::handleSearchKey(int keyCode) {
    using K = sf::Keyboard::Key;
    const auto key = static_cast<K>(keyCode);
    if (isPageFieldFocusedValue) {
        if (key == K::Backspace) {
            if (!pageInput.empty()) pageInput.pop_back();
        } else if (key == K::Escape) {
            pageInput.clear();
            isPageFieldFocusedValue = false;
        } else if (key == K::Enter) {
            const sf::Vector2u uiSize{
                static_cast<unsigned>(configRef.getInt("UI_DESIGN_WIDTH")),
                static_cast<unsigned>(configRef.getInt("UI_DESIGN_HEIGHT"))};
            commitPageInput(windowRect(uiSize));
        }
        return true;
    }
    if (!isSearchFocusedValue) return false;
    if (key == K::Backspace) {
        if (!searchQuery.empty()) searchQuery.pop_back();
        rebuildVisibleAssets();
    } else if (key == K::Escape) {
        searchQuery.clear();
        isSearchFocusedValue = false;
        rebuildVisibleAssets();
    } else if (key == K::Enter) {
        isSearchFocusedValue = false;
    }
    return true;
}

void WorldAssetGallery::selectFolder(const std::filesystem::path& folder) {
    currentDirectory = folder;
    searchQuery.clear();
    isPageFieldFocusedValue = false;
    rebuildVisibleAssets();
    statusValue = currentFolderLabel();
}

void WorldAssetGallery::markUsed(const std::string& assetPath) {
    if (assetPath.empty()) return;
    recentAssetPaths.erase(std::remove(recentAssetPaths.begin(), recentAssetPaths.end(), assetPath),
                           recentAssetPaths.end());
    recentAssetPaths.insert(recentAssetPaths.begin(), assetPath);
    if (recentAssetPaths.size() > 5u) recentAssetPaths.resize(5u);
    if (modeValue == WorldAssetGalleryMode::Small) rebuildVisibleAssets();
}

bool WorldAssetGallery::containsAsset(const std::string& assetPath) const {
    const auto* asset = findAsset(assetPath);
    if (!asset) return false;
    std::error_code error;
    return std::filesystem::is_regular_file(asset->absolutePath, error) && !error;
}

const WorldAssetGallery::AssetRecord* WorldAssetGallery::findAsset(
    const std::string& assetPath) const {
    const auto found = std::lower_bound(allAssets.begin(), allAssets.end(), assetPath,
        [](const AssetRecord& asset, const std::string& path) {
            return asset.assetPath < path;
        });
    return found != allAssets.end() && found->assetPath == assetPath ? &*found : nullptr;
}

const sf::Texture* WorldAssetGallery::thumbnailFor(const AssetRecord& asset) const {
    if (const auto found = thumbnails.find(asset.assetPath); found != thumbnails.end()) {
        return found->second.get();
    }
    if (failedThumbnails.contains(asset.assetPath)) return nullptr;
    sf::Image image;
    auto texture = std::make_shared<sf::Texture>();
    if (image.loadFromFile(asset.absolutePath)) {
        removeCornerGreenChroma(image, chromaGreenMinimum, chromaDominanceMinimum);
        if (texture->loadFromImage(image)) {
            const auto [inserted, _] = thumbnails.emplace(asset.assetPath, std::move(texture));
            return inserted->second.get();
        }
    }
    failedThumbnails.insert(asset.assetPath);
    return nullptr;
}

std::string WorldAssetGallery::currentFolderLabel() const {
    std::error_code error;
    const auto relative = std::filesystem::relative(currentDirectory, assetRoot, error);
    if (error || relative.empty() || relative == ".") return "assets/";
    return "assets/" + relative.generic_string() + "/";
}

void WorldAssetGallery::draw(sf::RenderTarget& target, sf::Vector2u uiSize,
                             const std::string& selectedAssetPath) const {
    const auto bounds = windowRect(uiSize);
    sf::RectangleShape background(bounds.size);
    background.setPosition(bounds.position);
    background.setFillColor(backgroundColor);
    background.setOutlineColor(outlineColor);
    background.setOutlineThickness(2.0f);
    target.draw(background);

    const std::string title = modeValue == WorldAssetGalleryMode::Large
        ? "ASSET GALLERY - SEARCH & BROWSE" : "ASSET GALLERY - RECENT 5";
    drawText(target, fontRef, title,
             {bounds.position.x + padding, bounds.position.y + padding},
             titleFontSize, textColor);

    const auto drawButton = [&](sf::FloatRect rect, const std::string& label) {
        sf::RectangleShape button(rect.size);
        button.setPosition(rect.position);
        button.setFillColor(folderColor);
        button.setOutlineColor(outlineColor);
        button.setOutlineThickness(1.0f);
        target.draw(button);
        drawText(target, fontRef, label, {rect.position.x + 7.0f, rect.position.y + 5.0f},
                 labelFontSize, textColor);
    };
    drawButton(modeButtonRect(bounds), modeValue == WorldAssetGalleryMode::Large
        ? "SMALL" : "BIG");
    drawButton(refreshButtonRect(bounds), "REFRESH");

    if (modeValue == WorldAssetGalleryMode::Large) {
        const auto search = searchRect(bounds);
        sf::RectangleShape searchBox(search.size);
        searchBox.setPosition(search.position);
        searchBox.setFillColor(cellColor);
        searchBox.setOutlineColor(isSearchFocusedValue ? selectedColor : dimColor);
        searchBox.setOutlineThickness(isSearchFocusedValue ? 2.0f : 1.0f);
        target.draw(searchBox);
        const std::string value = searchQuery.empty() && !isSearchFocusedValue
            ? "Search filename or folder path..." : searchQuery + (isSearchFocusedValue ? "|" : "");
        drawText(target, fontRef, value,
                 {search.position.x + 8.0f, search.position.y + 6.0f},
                 labelFontSize, searchQuery.empty() ? dimColor : textColor);

        const auto tree = folderTreeRect(bounds);
        sf::RectangleShape treeBackground(tree.size);
        treeBackground.setPosition(tree.position);
        treeBackground.setFillColor(cellColor);
        target.draw(treeBackground);
        const int visibleRows = std::max(1, static_cast<int>(
            std::floor(tree.size.y / std::max(1.0f, folderRowHeight))));
        const std::size_t last = std::min(visibleFolderIndices.size(),
            static_cast<std::size_t>(folderScrollRow + visibleRows));
        for (std::size_t visibleIndex = static_cast<std::size_t>(folderScrollRow);
             visibleIndex < last; ++visibleIndex) {
            const std::size_t folderIndex = visibleFolderIndices[visibleIndex];
            const auto& folder = folders[folderIndex];
            const float y = tree.position.y
                + static_cast<float>(
                    visibleIndex - static_cast<std::size_t>(folderScrollRow))
                * folderRowHeight;
            if (folder.absolutePath == currentDirectory) {
                sf::RectangleShape selected({tree.size.x, folderRowHeight});
                selected.setPosition({tree.position.x, y});
                selected.setFillColor(folderColor);
                target.draw(selected);
            }
            const float toggleStart = 6.0f
                + static_cast<float>(folder.depth) * folderIndent;
            if (folder.hasChildren) {
                const bool isCollapsed = collapsedFolderPaths.contains(
                    folderKey(folder.relativePath));
                drawText(target, fontRef, isCollapsed ? "+" : "-",
                         {tree.position.x + toggleStart, y + 4.0f},
                         labelFontSize, outlineColor);
            }
            const std::string name = folder.relativePath.empty()
                ? "assets" : folder.relativePath.filename().string();
            const std::string countSuffix = " ("
                + std::to_string(folder.descendantImageCount) + ")";
            const float labelStart = toggleStart + folderIndent;
            const std::size_t maximumCharacters = static_cast<std::size_t>(std::max(
                4.0f, (tree.size.x - labelStart - 6.0f) / (labelFontSize * 0.62f)));
            std::string fittedLabel;
            const std::size_t nameCharacters = maximumCharacters > countSuffix.size()
                ? maximumCharacters - countSuffix.size() : 1u;
            appendShortened(fittedLabel, name, nameCharacters);
            fittedLabel += countSuffix;
            drawText(target, fontRef, fittedLabel,
                     {tree.position.x + labelStart,
                      y + 4.0f}, labelFontSize, textColor);
        }
    }

    const auto grid = assetGridRect(bounds);
    const int columns = assetColumnCount(bounds);
    const float displayedCellHeight = assetCellHeight(bounds);
    const int displayedPage = std::clamp(
        assetPage, 0, assetPageCount(bounds) - 1);
    const std::size_t visible = static_cast<std::size_t>(assetPageSize(bounds));
    const std::size_t first = static_cast<std::size_t>(displayedPage) * visible;
    const std::size_t last = std::min(visibleAssets.size(), first + visible);
    for (std::size_t index = first; index < last; ++index) {
        const std::size_t local = index - first;
        const int column = static_cast<int>(local % static_cast<std::size_t>(columns));
        const int row = static_cast<int>(local / static_cast<std::size_t>(columns));
        const sf::Vector2f position{
            grid.position.x + static_cast<float>(column) * (cellWidth + cellGap),
            grid.position.y + static_cast<float>(row) * (displayedCellHeight + cellGap)};
        sf::RectangleShape cell({cellWidth, displayedCellHeight});
        cell.setPosition(position);
        cell.setFillColor(cellColor);
        const bool isSelected = visibleAssets[index].assetPath == selectedAssetPath;
        cell.setOutlineColor(isSelected ? selectedColor : dimColor);
        cell.setOutlineThickness(isSelected ? 3.0f : 1.0f);
        target.draw(cell);
        if (const auto* texture = thumbnailFor(visibleAssets[index])) {
            const auto size = texture->getSize();
            const float availableWidth = cellWidth - thumbnailPadding * 2.0f;
            const float availableHeight = std::max(1.0f, displayedCellHeight
                - labelFontSize - thumbnailPadding * 3.0f);
            const float scale = std::min(availableWidth / std::max(1.0f, static_cast<float>(size.x)),
                                         availableHeight / std::max(1.0f, static_cast<float>(size.y)));
            sf::Sprite sprite(*texture);
            sprite.setScale({scale, scale});
            sprite.setPosition({position.x + (cellWidth - static_cast<float>(size.x) * scale) * 0.5f,
                                position.y + thumbnailPadding});
            target.draw(sprite);
        }
        std::string label;
        appendShortened(label, visibleAssets[index].name, 16u);
        drawText(target, fontRef, label,
                 {position.x + thumbnailPadding,
                  position.y + displayedCellHeight - labelFontSize - thumbnailPadding},
                 labelFontSize, textColor);
    }
    if (visibleAssets.empty()) {
        drawText(target, fontRef,
                 modeValue == WorldAssetGalleryMode::Small
                    ? "No recent assets yet - use BIG mode to choose one"
                    : "No images match this folder/search",
                 {grid.position.x + 10.0f, grid.position.y + 10.0f},
                 labelFontSize, dimColor);
    }
    if (modeValue == WorldAssetGalleryMode::Large) {
        const auto pagination = paginationRect(bounds);
        const int pages = assetPageCount(bounds);
        const auto drawPageButton = [&](const sf::FloatRect& rect,
                                        const std::string& label,
                                        bool isEnabled) {
            sf::RectangleShape button(rect.size);
            button.setPosition(rect.position);
            button.setFillColor(isEnabled ? folderColor : cellColor);
            button.setOutlineColor(isEnabled ? outlineColor : dimColor);
            button.setOutlineThickness(1.0f);
            target.draw(button);
            drawText(target, fontRef, label,
                     {rect.position.x + rect.size.x * 0.36f,
                      rect.position.y + 5.0f},
                     labelFontSize, isEnabled ? textColor : dimColor);
        };
        drawPageButton(previousPageRect(bounds), "<", displayedPage > 0);
        drawPageButton(nextPageRect(bounds), ">", displayedPage + 1 < pages);

        const auto pageField = pageFieldRect(bounds);
        sf::RectangleShape field(pageField.size);
        field.setPosition(pageField.position);
        field.setFillColor(cellColor);
        field.setOutlineColor(isPageFieldFocusedValue ? selectedColor : outlineColor);
        field.setOutlineThickness(isPageFieldFocusedValue ? 2.0f : 1.0f);
        target.draw(field);
        const std::string pageValue = isPageFieldFocusedValue
            ? (pageInput.empty() ? "|" : pageInput + "|") + " / "
                + std::to_string(pages)
            : std::to_string(displayedPage + 1) + " / " + std::to_string(pages);
        drawText(target, fontRef, pageValue,
                 {pageField.position.x + 8.0f, pageField.position.y + 5.0f},
                 labelFontSize, textColor);

        const std::string summary = visibleAssets.empty()
            ? "0 images"
            : std::to_string(first + 1u) + "-"
                + std::to_string(last) + " of "
                + std::to_string(visibleAssets.size()) + " images";
        drawText(target, fontRef, summary,
                 {pagination.position.x, pagination.position.y + 5.0f},
                 labelFontSize, dimColor);
    }
}

} // namespace dof::render
