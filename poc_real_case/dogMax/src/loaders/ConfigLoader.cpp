#include "loaders/ConfigLoader.hpp"

#include "helpers/StringHelper.hpp"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <fstream>
#include <iostream>
#include <stdexcept>

namespace dof::loaders {

namespace {
// Phase G4 — the console-`save` sidecar. Lives in the primary config
// directory beside the base *.yaml files; leading underscore keeps it
// visually distinct and sorts it first. Skipped by the base directory
// scan and instead applied LAST (see applyOverridesFile) so its keys win.
constexpr const char* kOverridesFileName = "_overrides.yaml";

// Phase G5 — whole-string type probes for editable-row validation. `true`
// only when the ENTIRE token is consumed, so "12abc" is neither an integer
// nor a decimal. std::from_chars never allocates and never throws.
bool looksLikeInteger(const std::string& text) {
    if (text.empty()) return false;
    int value = 0;
    const char* begin = text.data();
    const char* end   = begin + text.size();
    const auto [ptr, ec] = std::from_chars(begin, end, value);
    return ec == std::errc() && ptr == end;
}

bool looksLikeDecimal(const std::string& text) {
    if (text.empty()) return false;
    // Probe at FLOAT width, matching the std::stof this gates — not double.
    // A double-width probe accepted 1e300, which then threw out_of_range in
    // stof: the editable Config row validated it, saveOverrides persisted it to
    // _overrides.yaml, and applyOverridesFile re-admitted it with the same
    // validator on every launch, so the bad token became a permanent crash.
    // looksLikeInteger already probes at int width for exactly this reason.
    float value = 0.0f;
    const char* begin = text.data();
    const char* end   = begin + text.size();
    const auto [ptr, ec] = std::from_chars(begin, end, value);
    // Reject inf/nan: from_chars' general format accepts "inf", "infinity" and
    // "nan", and std::stof happily returns them — a persisted NaN override then
    // poisons every value derived from it, silently.
    return ec == std::errc() && ptr == end && std::isfinite(value);
}
}

void ConfigLoader::loadDirectory(const std::filesystem::path& directory) {
    // Force the disk baseline: discard any console overrides first so EVERY key
    // is re-read from disk (loadFile only skips keys still in `overriddenKeys`).
    // This is the launch path — the "give me the disk values back" workflow.
    // Runtime reload shortcuts use loadDirectoryPreservingOverrides(), which
    // keeps console-tuned keys.
    // (Previously this method behaved identically to the preserving variant,
    // because it never cleared the override set — the documented contract was a
    // no-op.)
    overriddenKeys.clear();
    if (!std::filesystem::exists(directory) || !std::filesystem::is_directory(directory)) {
        throw std::runtime_error("ConfigLoader: directory not found: " + directory.string());
    }
    values.clear();
    sourceStemsByDirectory.clear();
    // Phase G4 — only the top-level directory load claims the override home.
    // Preserving reloads and effects-subdir loads never repoint it, so
    // saveOverrides always targets the real configs dir, not a sub-directory.
    sourceDirectory = directory;
    std::unordered_set<std::string> currentSourceStems;
    for (const auto& entry : std::filesystem::directory_iterator(directory)) {
        if (entry.is_regular_file() && entry.path().extension() == ".yaml"
            && entry.path().filename() != kOverridesFileName) {
            currentSourceStems.insert(entry.path().stem().string());
            loadFile(entry.path());
        }
    }
    sourceStemsByDirectory[directory.lexically_normal().string()] = std::move(currentSourceStems);
    // Phase G4 — apply persisted console overrides LAST so a prior
    // session's `save` survives a quit + relaunch (LAST-WINS over the
    // base configs). overriddenKeys was just cleared, so every persisted
    // key is applied and re-flagged as an override here.
    applyOverridesFile(directory / kOverridesFileName);
}

void ConfigLoader::loadDirectoryPreservingOverrides(const std::filesystem::path& directory) {
    // card-mpl8dyop — same iteration as `loadDirectory` but WITHOUT clearing the
    // override set first, so `loadFile` skips console-overridden keys and they
    // keep their runtime values across the reload. Untouched keys still pick up
    // fresh disk values; the override set survives until the next plain
    // loadDirectory() or a process restart. This matches the runtime behavior:
    // `,` restyles live and Ctrl+R restarts the run while keeping manual values.
    if (!std::filesystem::exists(directory) || !std::filesystem::is_directory(directory)) {
        throw std::runtime_error("ConfigLoader: directory not found: " + directory.string());
    }
    std::unordered_set<std::string> currentSourceStems;
    for (const auto& entry : std::filesystem::directory_iterator(directory)) {
        if (entry.is_regular_file() && entry.path().extension() == ".yaml"
            && entry.path().filename() != kOverridesFileName) {
            currentSourceStems.insert(entry.path().stem().string());
        }
    }
    const std::string directoryKey = directory.lexically_normal().string();
    auto affectedSourceStems = currentSourceStems;
    if (const auto previous = sourceStemsByDirectory.find(directoryKey);
        previous != sourceStemsByDirectory.end()) {
        affectedSourceStems.insert(previous->second.begin(), previous->second.end());
    }
    for (auto it = values.begin(); it != values.end();) {
        if (affectedSourceStems.contains(it->second.sourceFile)
            && !overriddenKeys.contains(it->first)) {
            it = values.erase(it);
        } else {
            ++it;
        }
    }
    for (const auto& entry : std::filesystem::directory_iterator(directory)) {
        if (entry.is_regular_file() && entry.path().extension() == ".yaml"
            && entry.path().filename() != kOverridesFileName) {
            loadFile(entry.path());
        }
    }
    sourceStemsByDirectory[directoryKey] = std::move(currentSourceStems);
    // Phase G4 — re-apply the sidecar LAST. applyOverridesFile skips keys
    // already overridden in memory, so a live (possibly unsaved) console
    // tweak always beats the on-disk value; only persisted keys the
    // current session hasn't touched get pulled back in. sourceDirectory
    // is deliberately NOT set here — the effects-subdir load routes
    // through this method too and must not steal the override home.
    applyOverridesFile(directory / kOverridesFileName);
}

void ConfigLoader::loadFile(const std::filesystem::path& filePath) {
    std::ifstream stream(filePath);
    if (!stream.is_open()) {
        throw std::runtime_error("ConfigLoader: cannot open " + filePath.string());
    }
    const std::string stem = filePath.stem().string();
    std::string line;
    int lineNumber = 0;
    while (std::getline(stream, line)) {
        ++lineNumber;
        const std::string stripped = dof::helpers::trim(line);
        if (stripped.empty() || stripped.front() == '#') {
            continue;
        }
        // Flat YAML mapping: "KEY: VALUE" — colon must be followed by
        // a space (or end-of-line for an empty value).
        const auto colonPos = stripped.find(':');
        if (colonPos == std::string::npos) {
            throw std::runtime_error("ConfigLoader: malformed line " + std::to_string(lineNumber)
                                     + " in " + filePath.string());
        }
        if (colonPos + 1 < stripped.size() && stripped[colonPos + 1] != ' ') {
            throw std::runtime_error("ConfigLoader: malformed line " + std::to_string(lineNumber)
                                     + " in " + filePath.string());
        }
        const std::string key = dof::helpers::trim(std::string_view(stripped).substr(0, colonPos));
        std::string val;
        if (colonPos + 2 <= stripped.size()) {
            val = dof::helpers::trim(std::string_view(stripped).substr(colonPos + 1));
        }
        // Strip surrounding double-quotes (allows quoting special values).
        if (val.size() >= 2 && val.front() == '"' && val.back() == '"') {
            val = val.substr(1, val.size() - 2);
        }
        if (key.empty()) {
            throw std::runtime_error("ConfigLoader: empty key on line " + std::to_string(lineNumber)
                                     + " in " + filePath.string());
        }
        // card-mpl8dyop — skip console-overridden keys so reload
        // doesn't clobber what the user explicitly tuned. New keys
        // (not yet in `values`) still flow in normally so a fresh
        // config file added between launches gets picked up.
        if (overriddenKeys.find(key) != overriddenKeys.end()) {
            // Preserve the runtime override; still record the
            // sourceFile if the entry didn't have one (defensive).
            auto it = values.find(key);
            if (it != values.end() && it->second.sourceFile == "<runtime>") {
                it->second.sourceFile = stem;
            }
            continue;
        }
        values[key] = ConfigEntry{val, stem};
    }
}

bool ConfigLoader::hasKey(const std::string& key) const {
    return values.find(key) != values.end();
}

int ConfigLoader::getInt(const std::string& key) const {
    const auto it = values.find(key);
    if (it == values.end()) throw std::runtime_error("ConfigLoader: missing int key: " + key);
    // std::stoi parses a leading numeric PREFIX and ignores the rest, so "5.9",
    // "0x10" and "5 # note" all became 5 silently. looksLikeInteger requires the
    // whole token to be consumed — crash early instead of half-reading a value.
    if (!looksLikeInteger(it->second.value)) {
        throw std::runtime_error("ConfigLoader: invalid int for key '" + key + "' = '" + it->second.value + "'");
    }
    try {
        return std::stoi(it->second.value);
    } catch (const std::exception&) {
        throw std::runtime_error("ConfigLoader: invalid int for key '" + key + "' = '" + it->second.value + "'");
    }
}

float ConfigLoader::getFloat(const std::string& key) const {
    const auto it = values.find(key);
    if (it == values.end()) throw std::runtime_error("ConfigLoader: missing float key: " + key);
    // Same whole-token requirement as getInt: std::stof("1.5abc") returned 1.5
    // without error. looksLikeDecimal accepts an integer too, so integer-valued
    // float keys still load.
    if (!looksLikeDecimal(it->second.value) && !looksLikeInteger(it->second.value)) {
        throw std::runtime_error("ConfigLoader: invalid float for key '" + key + "' = '" + it->second.value + "'");
    }
    try {
        return std::stof(it->second.value);
    } catch (const std::exception&) {
        throw std::runtime_error("ConfigLoader: invalid float for key '" + key + "' = '" + it->second.value + "'");
    }
}

bool ConfigLoader::getBool(const std::string& key) const {
    const auto it = values.find(key);
    if (it == values.end()) throw std::runtime_error("ConfigLoader: missing bool key: " + key);
    const auto& v = it->second.value;
    if (v == "1" || v == "true" || v == "TRUE" || v == "yes") return true;
    if (v == "0" || v == "false" || v == "FALSE" || v == "no") return false;
    throw std::runtime_error("ConfigLoader: invalid bool for key '" + key + "' = '" + v + "'");
}

std::string ConfigLoader::getString(const std::string& key) const {
    const auto it = values.find(key);
    if (it == values.end()) throw std::runtime_error("ConfigLoader: missing string key: " + key);
    return it->second.value;
}

const std::unordered_map<std::string, ConfigEntry>& ConfigLoader::entries() const {
    return values;
}

void ConfigLoader::setRaw(const std::string& key, const std::string& value) {
    auto updateKey = [&](const std::string& k) {
        auto it = values.find(k);
        if (it == values.end()) {
            values[k] = ConfigEntry{value, "<runtime>"};
        } else {
            it->second.value = value;
        }
    };
    updateKey(key);
}

void ConfigLoader::setOverride(const std::string& key, const std::string& value) {
    // Phase G5 — the editable Config tab's write path. Identical effect to
    // the console `set` verb (setRaw + markAsUserOverride): the value lands
    // in `values`, the key joins `overriddenKeys` (so saveOverrides persists
    // it and a preserving reload keeps it), and markAsUserOverride raises the
    // dirty edge that drives the live restyle.
    setRaw(key, value);
    markAsUserOverride(key);
}

bool ConfigLoader::isOverrideValueValid(const std::string& key,
                                        const std::string& candidate) const {
    if (candidate.empty()) return false;
    const auto it = values.find(key);
    if (it == values.end()) return true;  // unknown key: no type to preserve
    const std::string& current = it->second.value;
    // Preserve the numeric shape of the existing value so a downstream
    // getInt/getFloat can never throw on the stored override. Integer is
    // checked first because every integer also satisfies the decimal probe.
    if (looksLikeInteger(current)) return looksLikeInteger(candidate);
    if (looksLikeDecimal(current)) return looksLikeDecimal(candidate);
    return true;  // bool / free-form string keys accept any non-empty token
}

bool ConfigLoader::isConfigDirty() const { return configDirty; }

void ConfigLoader::clearConfigDirty() { configDirty = false; }

void ConfigLoader::markAsUserOverride(const std::string& key) {
    overriddenKeys.insert(key);
    // Phase G5 — every override (re)mark dirties the config so the live UI
    // restyles. This is the common sink for BOTH the console `set` verb
    // (Console.cpp) and the editable Config tab's setOverride, so a change
    // from either path shows on screen without a manual `,` reload. Load-
    // path callers (applyOverridesFile) also flip it, but GameSession clears
    // it the moment it (re)builds the renderers, so the launch/`,`/Ctrl+R
    // paths never leave a spurious dirty edge.
    configDirty = true;
}

bool ConfigLoader::isUserOverride(const std::string& key) const {
    return overriddenKeys.find(key) != overriddenKeys.end();
}

void ConfigLoader::clearUserOverride(const std::string& key) {
    overriddenKeys.erase(key);
}

std::vector<std::string> ConfigLoader::keysFromFile(const std::string& sourceFileStem) const {
    std::vector<std::string> out;
    for (const auto& [key, entry] : values) {
        if (entry.sourceFile == sourceFileStem) out.push_back(key);
    }
    return out;
}

void ConfigLoader::applyOverridesFile(const std::filesystem::path& filePath) {
    // Phase G4 — the console-`save` sidecar, applied after the base pass
    // so its keys win (LAST-WINS). Intentionally lenient: a blank/comment
    // line is skipped and a malformed line is ignored rather than thrown
    // on, so a corrupt or hand-edited sidecar can never brick launch.
    if (!std::filesystem::exists(filePath)) return;
    std::ifstream stream(filePath);
    if (!stream.is_open()) return;
    std::string line;
    while (std::getline(stream, line)) {
        const std::string stripped = dof::helpers::trim(line);
        if (stripped.empty() || stripped.front() == '#') continue;
        const auto colonPos = stripped.find(':');
        if (colonPos == std::string::npos) {
            std::cerr << "[config] skipping malformed override line (no colon): \"" << line << "\"\n";
            continue;
        }
        const std::string key = dof::helpers::trim(std::string_view(stripped).substr(0, colonPos));
        if (key.empty()) {
            std::cerr << "[config] skipping malformed override line (empty key): \"" << line << "\"\n";
            continue;
        }
        std::string val;
        if (colonPos + 1 <= stripped.size()) {
            val = dof::helpers::trim(std::string_view(stripped).substr(colonPos + 1));
        }
        if (val.size() >= 2 && val.front() == '"' && val.back() == '"') {
            val = val.substr(1, val.size() - 2);
        }
        // Preserve any newer in-memory override: only pull in persisted
        // keys the current session has NOT already changed. On the launch
        // path overriddenKeys was just cleared, so every persisted key is
        // applied + re-flagged here (restoring last session's tuning).
        if (overriddenKeys.find(key) != overriddenKeys.end()) continue;
        // Self-heal: skip a persisted override whose value no longer matches
        // the key's numeric shape (e.g. a pre-fix bad `set` that got saved),
        // so a corrupted sidecar can't brick launch via a downstream getInt.
        if (!isOverrideValueValid(key, val)) {
            std::cerr << "[config] skipping override with invalid value for key \"" << key
                      << "\": \"" << val << "\"\n";
            continue;
        }
        setRaw(key, val);
        markAsUserOverride(key);
    }
}

int ConfigLoader::saveOverrides() const {
    // Phase G4 — rewrite the sidecar from scratch (truncate) with every
    // currently-overridden key as flat `KEY: value`, sorted for a stable
    // diff. Returns the count written, or -1 if the file could not be
    // opened (the console reports the failure instead of crashing).
    const auto path = overridesFilePath();
    std::ofstream out(path, std::ios::trunc);
    if (!out.is_open()) return -1;
    out << "# Auto-generated by the in-game console `save` verb.\n";
    out << "# Console overrides, applied LAST-WINS over the base configs on\n";
    out << "# load. Safe to delete; regenerated on the next `save`.\n";
    std::vector<std::string> keys(overriddenKeys.begin(), overriddenKeys.end());
    std::sort(keys.begin(), keys.end());
    int count = 0;
    for (const auto& key : keys) {
        const auto it = values.find(key);
        if (it == values.end()) continue;
        out << key << ": " << it->second.value << "\n";
        ++count;
    }
    return count;
}

std::filesystem::path ConfigLoader::overridesFilePath() const {
    return sourceDirectory / kOverridesFileName;
}

}
