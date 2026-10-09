#pragma once

#include <span>
#include <string>
#include <vector>

namespace dof::loaders { class ConfigLoader; }

namespace dof::combat {

enum class DronTier {
    Hexadron,
    Pentadron,
    TwinTridron,
    QuadDuodron,
    Omidron,
    Hemidron,
    TriduoDron,
    Tetradron,
    Lineadron,
    SplitSeqdron,
    Mixdron,
    Minidron,
    Tridron,
    Duodron,
    Voidron
};

struct DronResult {
    DronTier    tier{DronTier::Voidron};
    float       multiplier{1.0f};
    std::string name{"Voidron"};
    bool        isSilent{true};
};

class DronDetector {
public:
    explicit DronDetector(const dof::loaders::ConfigLoader& config);

    // faceCounts is a per-die parallel to diceFaces (same order and length)
    // carrying each die's total face count, so Hemidron's high/low split can
    // be face-count-relative rather than a fixed d6 threshold. Defaulted empty
    // for preview callers that classify a bare value list; when it is absent
    // Hemidron falls back to the canonical die size (see classify()).
    DronResult classify(std::span<const int> diceFaces,
                        std::span<const int> faceCounts = {}) const;
    float      multiplierFor(DronTier tier) const;
    static const char* nameFor(DronTier tier);

private:
    float multHexadron;
    float multPentadron;
    float multTwinTridron;
    float multQuadDuodron;
    float multOmidron;
    float multHemidron;
    float multTriduoDron;
    float multTetradron;
    float multLineadron;
    float multSplitSeqdron;
    float multMixdron;
    float multMinidron;
    float multTridron;
    float multDuodron;
    float multVoidron;

    // Pattern-detection thresholds (configs/dron_patterns.yaml), read in the
    // ctor. No tier constant is hard-coded in the detector.
    float hemidronSplitRatio;
    int   lineadronStraightLength;
    int   minidronStraightLength;
    int   omidronMinFace;
    int   omidronMaxFace;
};

}
