#include "entities/SpecialEnemyKind.hpp"

#include <string>

namespace dof::entities {

std::string_view specialEnemyKindLabel(SpecialEnemyKind kind) {
    switch (kind) {
        case SpecialEnemyKind::None:              return "None";
        case SpecialEnemyKind::Shocker:           return "Shocker";
        case SpecialEnemyKind::Glasswraith:       return "Glasswraith";
        case SpecialEnemyKind::Hexarchon:         return "Hexarchon";
        case SpecialEnemyKind::TassideanSentinel: return "Tassidean Sentinel";
        case SpecialEnemyKind::Voidcrawler:       return "Voidcrawler";
        case SpecialEnemyKind::PactWalker:        return "Pact-Walker";
    }
    return "Unknown";
}

std::string_view specialEnemyKindCanonicalToken(SpecialEnemyKind kind) {
    switch (kind) {
        case SpecialEnemyKind::None:              return "none";
        case SpecialEnemyKind::Shocker:           return "shocker";
        case SpecialEnemyKind::Glasswraith:       return "glasswraith";
        case SpecialEnemyKind::Hexarchon:         return "hexarchon";
        case SpecialEnemyKind::TassideanSentinel: return "tassideansentinel";
        case SpecialEnemyKind::Voidcrawler:       return "voidcrawler";
        case SpecialEnemyKind::PactWalker:        return "pactwalker";
    }
    return "unknown";
}

bool parseSpecialEnemyKindToken(const std::string& token, SpecialEnemyKind& out) {
    // Normalise: lowercase + strip space/hyphen/underscore so
    // `Tassidean Sentinel`, `tassidean-sentinel`, and
    // `TASSIDEANSENTINEL` all match the same canonical token. A
    // user-supplied "none" is rejected because the cheat caller
    // expects a real special kind (random path is opt-in via
    // omitting the 2nd arg entirely).
    std::string norm;
    norm.reserve(token.size());
    for (char c : token) {
        if (c == ' ' || c == '-' || c == '_') continue;
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c + ('a' - 'A'));
        norm.push_back(c);
    }
    if (norm.empty() || norm == "none") return false;
    constexpr SpecialEnemyKind kCandidates[] = {
        SpecialEnemyKind::Shocker,
        SpecialEnemyKind::Glasswraith,
        SpecialEnemyKind::Hexarchon,
        SpecialEnemyKind::TassideanSentinel,
        SpecialEnemyKind::Voidcrawler,
        SpecialEnemyKind::PactWalker,
    };
    for (auto candidate : kCandidates) {
        if (norm == specialEnemyKindCanonicalToken(candidate)) {
            out = candidate;
            return true;
        }
    }
    return false;
}

}
