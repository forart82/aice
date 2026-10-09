#pragma once

namespace dof::abilities { struct Damageable; }
namespace dof::loaders { class ConfigLoader; }

namespace dof::hubs {

// Run-local stored healing. Empty death-loot outcomes add reserve; holding Q
// transfers it into missing hero HP without discarding any unused amount.
class VitalityTank {
public:
    explicit VitalityTank(const dof::loaders::ConfigLoader& config);

    float addEmptyKillCharge();
    float transferTo(dof::abilities::Damageable& damageable, float dt);
    void reset();

    float reserve() const;
    float capacity() const;
    float fillRatio() const;

private:
    const dof::loaders::ConfigLoader& configRef;
    float reserveAmount{0.0f};
};

}
