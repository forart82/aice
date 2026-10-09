#pragma once

namespace dof::entities { enum class QualityTier; }
namespace dof::loaders { class ConfigLoader; }

namespace dof::combat {

// Playable quality factor from the current loot contract.
//   factor = minimumFactor + (1 - minimumFactor) * q/100
// q is clamped to [1, 100], and minimumFactor to [0, 1].
float qualityStatFactor(int qualityScore, float minimumFactor);

// Quality-and-level multiplier for stats with linear item-level growth.
//   m = qualityStatFactor(q, minimumFactor) * max(1, itemLevel)
float universalMultiplier(int qualityScore, int itemLevel, float minimumFactor);

// SE11 / spec L1788 — per-tier stat multiplier applied INDEPENDENTLY
// of `m` so the loot pipeline produces `finalStat = base · m · qualityMult`.
// Reads `QUALITY_STAT_MULT_{COMMON,UNCOMMON,RARE}` from quality.yaml.
float qualityStatMultiplier(dof::entities::QualityTier tier,
                            const dof::loaders::ConfigLoader& config);

}
