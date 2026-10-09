#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/System/Vector2.hpp>

#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace dof::loaders { class ConfigLoader; }
namespace sf { class Font; class RenderTarget; class Texture; }

namespace dof::render {

enum class WorldAssetGalleryMode { Large, Small };

struct WorldAssetGalleryPress {
    bool isConsumed{false};
    std::optional<std::string> assetPath;
};

class WorldAssetGallery {
public:
    WorldAssetGallery(const dof::loaders::ConfigLoader& config,
                      const sf::Font& font);

    void refresh();
    void toggleMode();
    WorldAssetGalleryPress handlePress(sf::Vector2f uiPosition,
                                       sf::Vector2u uiSize);
    bool handleWheel(float delta, sf::Vector2f uiPosition,
                     sf::Vector2u uiSize);
    void handleTextEntered(char32_t unicode);
    bool handleSearchKey(int keyCode);
    void markUsed(const std::string& assetPath);
    bool containsAsset(const std::string& assetPath) const;
    void draw(sf::RenderTarget& target, sf::Vector2u uiSize,
              const std::string& selectedAssetPath) const;

    sf::FloatRect windowRect(sf::Vector2u uiSize) const;
    bool isSearchFocused() const {
        return isSearchFocusedValue || isPageFieldFocusedValue;
    }
    WorldAssetGalleryMode mode() const { return modeValue; }
    const std::string& status() const { return statusValue; }

private:
    struct AssetRecord {
        std::string name;
        std::filesystem::path absolutePath;
        std::filesystem::path relativeFolder;
        std::string assetPath;
    };

    struct FolderRecord {
        std::filesystem::path absolutePath;
        std::filesystem::path relativePath;
        int depth{0};
        std::optional<std::size_t> parentIndex;
        std::size_t descendantImageCount{0};
        bool hasChildren{false};
    };

    sf::FloatRect modeButtonRect(const sf::FloatRect& bounds) const;
    sf::FloatRect refreshButtonRect(const sf::FloatRect& bounds) const;
    sf::FloatRect searchRect(const sf::FloatRect& bounds) const;
    sf::FloatRect folderTreeRect(const sf::FloatRect& bounds) const;
    sf::FloatRect assetGridRect(const sf::FloatRect& bounds) const;
    sf::FloatRect paginationRect(const sf::FloatRect& bounds) const;
    sf::FloatRect previousPageRect(const sf::FloatRect& bounds) const;
    sf::FloatRect pageFieldRect(const sf::FloatRect& bounds) const;
    sf::FloatRect nextPageRect(const sf::FloatRect& bounds) const;
    std::optional<std::size_t> folderAt(sf::Vector2f uiPosition,
                                        const sf::FloatRect& bounds) const;
    std::optional<std::size_t> assetAt(sf::Vector2f uiPosition,
                                       const sf::FloatRect& bounds) const;
    int assetColumnCount(const sf::FloatRect& bounds) const;
    float assetCellHeight(const sf::FloatRect& bounds) const;
    int visibleAssetRows(const sf::FloatRect& bounds) const;
    int assetPageSize(const sf::FloatRect& bounds) const;
    int assetPageCount(const sf::FloatRect& bounds) const;
    int maximumFolderScrollRow(const sf::FloatRect& bounds) const;
    const sf::Texture* thumbnailFor(const AssetRecord& asset) const;
    void rebuildIndex();
    void rebuildVisibleFolders();
    void rebuildVisibleAssets();
    void selectFolder(const std::filesystem::path& folder);
    void toggleFolder(std::size_t folderIndex);
    void selectAssetPage(int page, const sf::FloatRect& bounds);
    void commitPageInput(const sf::FloatRect& bounds);
    bool isFolderToggleAt(sf::Vector2f uiPosition,
                          const sf::FloatRect& bounds,
                          std::size_t folderIndex) const;
    const AssetRecord* findAsset(const std::string& assetPath) const;
    std::string currentFolderLabel() const;

    const dof::loaders::ConfigLoader& configRef;
    const sf::Font& fontRef;
    std::filesystem::path assetRoot;
    std::filesystem::path currentDirectory;
    std::vector<AssetRecord> allAssets;
    std::vector<AssetRecord> visibleAssets;
    std::vector<FolderRecord> folders;
    std::vector<std::size_t> visibleFolderIndices;
    std::vector<std::string> recentAssetPaths;
    mutable std::unordered_map<std::string, std::shared_ptr<sf::Texture>> thumbnails;
    mutable std::unordered_set<std::string> failedThumbnails;
    std::unordered_set<std::string> collapsedFolderPaths;
    WorldAssetGalleryMode modeValue{WorldAssetGalleryMode::Large};
    bool isSearchFocusedValue{false};
    bool isPageFieldFocusedValue{false};
    bool isFolderExpansionInitialized{false};
    int assetPage{0};
    int folderScrollRow{0};
    std::string searchQuery;
    std::string pageInput;
    std::string statusValue{"Ready"};

    float largeWidth{820.0f};
    float largeHeight{680.0f};
    float largeX{18.0f};
    float largeY{18.0f};
    float smallWidth{650.0f};
    float smallHeight{145.0f};
    float smallX{18.0f};
    float smallY{18.0f};
    float padding{10.0f};
    float titleBarHeight{42.0f};
    float searchHeight{32.0f};
    float folderTreeWidth{235.0f};
    float folderRowHeight{24.0f};
    float folderIndent{14.0f};
    float cellWidth{120.0f};
    float cellHeight{102.0f};
    float cellGap{6.0f};
    float thumbnailPadding{7.0f};
    float labelFontSize{12.0f};
    float titleFontSize{15.0f};
    float buttonWidth{94.0f};
    float buttonHeight{26.0f};
    sf::Color backgroundColor{5, 9, 14, 245};
    sf::Color cellColor{18, 28, 36, 245};
    sf::Color folderColor{22, 70, 82, 245};
    sf::Color selectedColor{255, 190, 50, 255};
    sf::Color outlineColor{0, 190, 220, 220};
    sf::Color textColor{220, 235, 240, 255};
    sf::Color dimColor{120, 145, 155, 255};
    int chromaGreenMinimum{80};
    int chromaDominanceMinimum{12};
};

} // namespace dof::render
