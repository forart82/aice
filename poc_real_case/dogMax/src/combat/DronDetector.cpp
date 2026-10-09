#include "combat/DronDetector.hpp"

#include "loaders/ConfigLoader.hpp"

#include <algorithm>
#include <array>
#include <set>

namespace dof::combat {

namespace {

std::vector<int> sortedCounts(std::span<const int> faces) {
    std::array<int, 101> histogram{};
    for (int face : faces) {
        if (face >= 1 && face <= 100) ++histogram[static_cast<size_t>(face)];
    }
    std::vector<int> counts;
    for (size_t i = 1; i < histogram.size(); ++i) {
        if (histogram[i] > 0) counts.push_back(histogram[i]);
    }
    std::sort(counts.rbegin(), counts.rend());
    return counts;
}

bool hasNOfAKind(const std::vector<int>& counts, int n) {
    return std::any_of(counts.begin(), counts.end(), [n](int c) { return c >= n; });
}

bool isPattern(const std::vector<int>& counts, std::initializer_list<int> pattern) {
    if (counts.size() != pattern.size()) return false;
    auto it = pattern.begin();
    for (size_t i = 0; i < counts.size(); ++i, ++it) {
        if (counts[i] != *it) return false;
    }
    return true;
}

bool containsStraight(std::span<const int> faces, int length) {
    if (length <= 0) return false;
    std::set<int> uniqueFaces(faces.begin(), faces.end());
    int run = 0;
    int previous = -10;
    for (int value : uniqueFaces) {
        if (value == previous + 1) ++run;
        else run = 1;
        previous = value;
        if (run >= length) return true;
    }
    return false;
}

bool isOmidron(std::span<const int> faces, int minFace, int maxFace) {
    // "Rainbow": one die on every face across the inclusive minFace..maxFace
    // span. The required count of distinct faces IS that span
    // (maxFace - minFace + 1), so both the size guard and the uniqueness
    // check derive from config rather than a hard-coded 6.
    const int requiredSpan = maxFace - minFace + 1;
    if (static_cast<int>(faces.size()) < requiredSpan) return false;
    std::set<int> uniqueFaces(faces.begin(), faces.end());
    if (static_cast<int>(uniqueFaces.size()) != requiredSpan) return false;
    return *uniqueFaces.begin() == minFace && *uniqueFaces.rbegin() == maxFace;
}

bool isHemidron(std::span<const int> faces,
                std::span<const int> faceCounts,
                float splitRatio,
                int fallbackFaceCount) {
    if (faces.size() < 3) return false;
    // Face-count-relative split. Each die is HIGH when its rolled value is
    // strictly above its OWN midpoint (faceCount * splitRatio) and LOW when it
    // is at or below it. For a d6 the midpoint is 3 (reproducing the original
    // >3 / <=3 split); for a d100 it is 50, so "all high" stops being the
    // ~83% freebie a fixed d6 threshold handed every d100 roll (~1.6% instead).
    //   allHigh -> every die strictly above its midpoint
    //   allLow  -> every die at or below its midpoint
    // When per-die counts are absent (a preview caller passing no counts) the
    // canonical die size stands in so the result stays defined and stable.
    const bool haveCounts = (faceCounts.size() == faces.size());
    bool allLow = true;
    bool allHigh = true;
    for (std::size_t i = 0; i < faces.size(); ++i) {
        const int faceCount = haveCounts ? faceCounts[i] : fallbackFaceCount;
        const float midpoint = static_cast<float>(faceCount) * splitRatio;
        const float value = static_cast<float>(faces[i]);
        if (value > midpoint) allLow = false;
        if (value <= midpoint) allHigh = false;
    }
    return allLow || allHigh;
}

bool isSplitSequence(std::span<const int> faces) {
    std::set<int> uniqueFaces(faces.begin(), faces.end());
    const bool lowRun = uniqueFaces.count(1) && uniqueFaces.count(2) && uniqueFaces.count(3);
    const bool highRun = uniqueFaces.count(4) && uniqueFaces.count(5) && uniqueFaces.count(6);
    return lowRun && highRun;
}

bool containsFullHouse(const std::vector<int>& counts) {
    bool hasThree = false;
    bool hasTwo = false;
    for (int count : counts) {
        if (!hasThree && count >= 3) { hasThree = true; continue; }
        if (!hasTwo && count >= 2) hasTwo = true;
    }
    return hasThree && hasTwo;
}

}

DronDetector::DronDetector(const dof::loaders::ConfigLoader& config) {
    multHexadron      = config.getFloat("DRON_MULT_HEXADRON");
    multPentadron     = config.getFloat("DRON_MULT_PENTADRON");
    multTwinTridron   = config.getFloat("DRON_MULT_TWIN_TRIDRON");
    multQuadDuodron   = config.getFloat("DRON_MULT_QUAD_DUODRON");
    multOmidron       = config.getFloat("DRON_MULT_OMIDRON");
    multHemidron      = config.getFloat("DRON_MULT_HEMIDRON");
    multTriduoDron    = config.getFloat("DRON_MULT_TRIDUO_DRON");
    multTetradron     = config.getFloat("DRON_MULT_TETRADRON");
    multLineadron     = config.getFloat("DRON_MULT_LINEADRON");
    multSplitSeqdron  = config.getFloat("DRON_MULT_SPLIT_SEQDRON");
    multMixdron       = config.getFloat("DRON_MULT_MIXDRON");
    multMinidron      = config.getFloat("DRON_MULT_MINIDRON");
    multTridron       = config.getFloat("DRON_MULT_TRIDRON");
    multDuodron       = config.getFloat("DRON_MULT_DUODRON");
    multVoidron       = config.getFloat("DRON_MULT_VOIDRON");

    // Pattern-detection thresholds (configs/dron_patterns.yaml). Externalised
    // so d6-vs-d100 tier balance is tunable without a rebuild — no tier
    // constant is hard-coded in this translation unit.
    hemidronSplitRatio      = config.getFloat("DRON_HEMIDRON_SPLIT_RATIO");
    lineadronStraightLength = config.getInt("DRON_LINEADRON_STRAIGHT_LENGTH");
    minidronStraightLength  = config.getInt("DRON_MINIDRON_STRAIGHT_LENGTH");
    omidronMinFace          = config.getInt("DRON_OMIDRON_MIN_FACE");
    omidronMaxFace          = config.getInt("DRON_OMIDRON_MAX_FACE");
}

const char* DronDetector::nameFor(DronTier tier) {
    switch (tier) {
        case DronTier::Hexadron:      return "Hexadron";
        case DronTier::Pentadron:     return "Pentadron";
        case DronTier::TwinTridron:   return "Twin-Tridron";
        case DronTier::QuadDuodron:   return "Quad-Duodron";
        case DronTier::Omidron:       return "Omidron";
        case DronTier::Hemidron:      return "Hemidron";
        case DronTier::TriduoDron:    return "Triduo-Dron";
        case DronTier::Tetradron:     return "Tetradron";
        case DronTier::Lineadron:     return "Lineadron";
        case DronTier::SplitSeqdron:  return "Split-Seqdron";
        case DronTier::Mixdron:       return "Mixdron";
        case DronTier::Minidron:      return "Minidron";
        case DronTier::Tridron:       return "Tridron";
        case DronTier::Duodron:       return "Duodron";
        case DronTier::Voidron:       return "Voidron";
    }
    return "Voidron";
}

float DronDetector::multiplierFor(DronTier tier) const {
    switch (tier) {
        case DronTier::Hexadron:      return multHexadron;
        case DronTier::Pentadron:     return multPentadron;
        case DronTier::TwinTridron:   return multTwinTridron;
        case DronTier::QuadDuodron:   return multQuadDuodron;
        case DronTier::Omidron:       return multOmidron;
        case DronTier::Hemidron:      return multHemidron;
        case DronTier::TriduoDron:    return multTriduoDron;
        case DronTier::Tetradron:     return multTetradron;
        case DronTier::Lineadron:     return multLineadron;
        case DronTier::SplitSeqdron:  return multSplitSeqdron;
        case DronTier::Mixdron:       return multMixdron;
        case DronTier::Minidron:      return multMinidron;
        case DronTier::Tridron:       return multTridron;
        case DronTier::Duodron:       return multDuodron;
        case DronTier::Voidron:       return multVoidron;
    }
    return multVoidron;
}

DronResult DronDetector::classify(std::span<const int> diceFaces,
                                  std::span<const int> faceCounts) const {
    auto returnTier = [this](DronTier tier) {
        DronResult result;
        result.tier = tier;
        result.multiplier = multiplierFor(tier);
        result.name = nameFor(tier);
        result.isSilent = (tier == DronTier::Voidron);
        return result;
    };

    if (diceFaces.empty()) return returnTier(DronTier::Voidron);
    const auto counts = sortedCounts(diceFaces);

    if (isPattern(counts, {6})) return returnTier(DronTier::Hexadron);
    if (hasNOfAKind(counts, 5)) return returnTier(DronTier::Pentadron);
    if (isPattern(counts, {3, 3})) return returnTier(DronTier::TwinTridron);
    if (isPattern(counts, {4, 2})) return returnTier(DronTier::QuadDuodron);
    if (isOmidron(diceFaces, omidronMinFace, omidronMaxFace)) return returnTier(DronTier::Omidron);
    // Hemidron uses a face-count-relative split; when a caller supplies no
    // per-die counts, omidronMaxFace stands in as the canonical die size so a
    // count-less preview keeps the classic d6 midpoint.
    if (isHemidron(diceFaces, faceCounts, hemidronSplitRatio, omidronMaxFace))
        return returnTier(DronTier::Hemidron);
    if (isPattern(counts, {2, 2, 2})) return returnTier(DronTier::TriduoDron);
    if (hasNOfAKind(counts, 4))   return returnTier(DronTier::Tetradron);
    // P1.3 — test Lineadron (x10) BEFORE Split-Seqdron (x8): tiers are
    // evaluated highest-multiplier-first, and the previous order let the
    // lower-multiplier Split-Seqdron short-circuit a qualifying Lineadron.
    if (containsStraight(diceFaces, lineadronStraightLength)) return returnTier(DronTier::Lineadron);
    if (isSplitSequence(diceFaces))                           return returnTier(DronTier::SplitSeqdron);
    if (containsFullHouse(counts))      return returnTier(DronTier::Mixdron);
    if (containsStraight(diceFaces, minidronStraightLength)) return returnTier(DronTier::Minidron);
    if (hasNOfAKind(counts, 3))   return returnTier(DronTier::Tridron);
    if (hasNOfAKind(counts, 2))   return returnTier(DronTier::Duodron);

    return returnTier(DronTier::Voidron);
}

}
