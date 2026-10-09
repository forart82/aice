#include "entities/Dice.hpp"

namespace dof::entities {

int diceFaceCount(DiceFace face) {
    switch (face) {
        case DiceFace::D4:   return 4;
        case DiceFace::D6:   return 6;
        case DiceFace::D8:   return 8;
        case DiceFace::D12:  return 12;
        case DiceFace::D20:  return 20;
        case DiceFace::D24:  return 24;
        case DiceFace::D30:  return 30;
        case DiceFace::D42:  return 42;
        case DiceFace::D60:  return 60;
        case DiceFace::D100: return 100;
    }
    return 6;
}

const char* diceFaceLabel(DiceFace face) {
    switch (face) {
        case DiceFace::D4:   return "d4";
        case DiceFace::D6:   return "d6";
        case DiceFace::D8:   return "d8";
        case DiceFace::D12:  return "d12";
        case DiceFace::D20:  return "d20";
        case DiceFace::D24:  return "d24";
        case DiceFace::D30:  return "d30";
        case DiceFace::D42:  return "d42";
        case DiceFace::D60:  return "d60";
        case DiceFace::D100: return "d100";
    }
    return "d?";
}

bool parseDiceFaceCountToken(const std::string& token, DiceFace& out) {
    // Digit-only — leading `d`/`D` tolerated so a user may type
    // `SpawnDice=10,d20` or `SpawnDice=10,20`. Anything else (empty,
    // negative sign, letters, a face count not in the canonical
    // ten) is rejected.
    if (token.empty()) return false;
    std::size_t i = 0;
    if (token[0] == 'd' || token[0] == 'D') i = 1;
    if (i >= token.size()) return false;
    int value = 0;
    for (; i < token.size(); ++i) {
        const char c = token[i];
        if (c < '0' || c > '9') return false;
        value = value * 10 + (c - '0');
        if (value > 1000) return false;
    }
    switch (value) {
        case 4:   out = DiceFace::D4;   return true;
        case 6:   out = DiceFace::D6;   return true;
        case 8:   out = DiceFace::D8;   return true;
        case 12:  out = DiceFace::D12;  return true;
        case 20:  out = DiceFace::D20;  return true;
        case 24:  out = DiceFace::D24;  return true;
        case 30:  out = DiceFace::D30;  return true;
        case 42:  out = DiceFace::D42;  return true;
        case 60:  out = DiceFace::D60;  return true;
        case 100: out = DiceFace::D100; return true;
        default:  return false;
    }
}

Dice::Dice(dof::core::EntityId id, DiceFace face)
    : identity(id), faceKind(face), facesTotal(diceFaceCount(face)) {
    faceShown = 1;
    faceValues.resize(static_cast<std::size_t>(facesTotal));
    for (int i = 0; i < facesTotal; ++i) faceValues[static_cast<std::size_t>(i)] = i + 1;
}

dof::core::EntityId Dice::id() const { return identity; }
DiceFace Dice::face() const { return faceKind; }
int Dice::faceCount() const { return facesTotal; }
int Dice::currentFace() const { return faceShown; }

void Dice::setCurrentFace(int face) {
    if (face < 1) face = 1;
    if (face > facesTotal) face = facesTotal;
    faceShown = face;
}

int Dice::faceValue(int faceIndex) const {
    if (faceIndex < 1 || faceIndex > facesTotal) return faceIndex;
    return faceValues[static_cast<std::size_t>(faceIndex - 1)];
}

void Dice::setFaceValue(int faceIndex, int value) {
    if (faceIndex < 1 || faceIndex > facesTotal) return;
    if (value < 1) value = 1;
    faceValues[static_cast<std::size_t>(faceIndex - 1)] = value;
}

void Dice::resetFaceValues() {
    for (int i = 0; i < facesTotal; ++i)
        faceValues[static_cast<std::size_t>(i)] = i + 1;
}

void Dice::evolveToFace(DiceFace newFace) {
    const int newCount = diceFaceCount(newFace);
    if (newCount <= facesTotal) return;
    const int old = facesTotal;
    faceKind   = newFace;
    facesTotal = newCount;
    faceValues.resize(static_cast<std::size_t>(newCount));
    for (int i = old; i < newCount; ++i)
        faceValues[static_cast<std::size_t>(i)] = 1;
    if (faceShown > facesTotal) faceShown = facesTotal;
}

float Dice::damageMultiplier() const { return damageMultiplierValue; }
void  Dice::setDamageMultiplier(float value) { damageMultiplierValue = value; }
float Dice::crit() const { return critValue; }
float Dice::critChance() const { return critChanceValue; }
int   Dice::luck() const { return luckValue; }
float Dice::evasionPerSlot() const { return evasionPerSlotValue; }

void Dice::setCrit(float crit, float critChance) {
    critValue = crit;
    critChanceValue = critChance;
}
void Dice::setLuck(int luck) { luckValue = luck; }
void Dice::setEvasionPerSlot(float evasionPerSlot) { evasionPerSlotValue = evasionPerSlot; }

const std::string& Dice::displayName() const { return name; }
void Dice::setDisplayName(std::string n) { name = std::move(n); }

QualityTier Dice::tier() const { return qualityTier; }
void Dice::setTier(QualityTier value) { qualityTier = value; }
int  Dice::qualityScore() const { return qualityScoreValue; }
void Dice::setQualityScore(int value) { qualityScoreValue = value; }
int  Dice::itemLevel() const { return itemLevelValue; }
void Dice::setItemLevel(int value) { itemLevelValue = value; }

bool Dice::isCrafted() const { return crafted; }
void Dice::setCrafted(bool value) { crafted = value; }

float Dice::faceCycleAccumulator() const { return faceCycleAccumulatorValue; }
void  Dice::setFaceCycleAccumulator(float value) { faceCycleAccumulatorValue = value; }

dof::abilities::Countdownable& Dice::countdownable() { return countdownableComponent; }
dof::abilities::Pickupable&    Dice::pickupable()    { return pickupableComponent; }
const dof::abilities::Countdownable& Dice::countdownable() const { return countdownableComponent; }
const dof::abilities::Pickupable&    Dice::pickupable()    const { return pickupableComponent; }

}
