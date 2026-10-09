#pragma once

#include <filesystem>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace dof::loaders {

struct ConfigEntry {
    std::string value;
    std::string sourceFile;
};

class ConfigLoader {
public:
    void loadDirectory(const std::filesystem::path& directory);
    void loadFile(const std::filesystem::path& filePath);

    // card-mpl8dyop — Ctrl+R reload semantics: re-read every
    // `*.yaml` file from disk EXCEPT keys the user explicitly
    // mutated via the in-game console (tracked through
    // `markAsUserOverride`). Disk values still flow into untouched
    // keys; user-overridden keys keep their current runtime value.
    // A fresh process start (no overrides yet) behaves identically
    // to `loadDirectory` so the launch-from-disk baseline is
    // unchanged.
    void loadDirectoryPreservingOverrides(const std::filesystem::path& directory);

    bool        hasKey(const std::string& key) const;
    int         getInt(const std::string& key) const;
    float       getFloat(const std::string& key) const;
    bool        getBool(const std::string& key) const;
    std::string getString(const std::string& key) const;

    const std::unordered_map<std::string, ConfigEntry>& entries() const;
    void setRaw(const std::string& key, const std::string& value);

    // Phase G5 — in-game editable Config tab. One-call override write: set
    // the value AND flag the key as a user override (so `saveOverrides`
    // persists it and `loadDirectoryPreservingOverrides` keeps it), exactly
    // like the console `set` verb does. Marking the override raises the
    // config-dirty signal (see markAsUserOverride) so GameSession re-applies
    // config to the renderers on the next frame and the edit shows LIVE.
    void setOverride(const std::string& key, const std::string& value);

    // Phase G5 — minimal, crash-avoiding validation for an editable-row
    // commit. Rejects an empty candidate. When the key's CURRENT value
    // parses cleanly as an integer (resp. a decimal), the candidate must
    // parse the same way, so a later getInt/getFloat can never throw on the
    // stored override; bool/free-form-string keys accept any non-empty
    // token, and an unknown key accepts anything (no type to preserve).
    bool isOverrideValueValid(const std::string& key, const std::string& candidate) const;

    // Phase G5 — the "config changed, restyle the live UI" edge. Raised
    // whenever an override is (re)marked (console `set`, an editable-row
    // commit, or a persisted override restored on load) and lowered by
    // GameSession once it has re-applied the config to every renderer.
    bool isConfigDirty() const;
    void clearConfigDirty();

    // card-mpl8dyop — flag a key as console-overridden so the next
    // `loadDirectoryPreservingOverrides` call skips it. Idempotent —
    // multiple console writes to the same key keep the override
    // status. Called by Console after a SetKey statement.
    void markAsUserOverride(const std::string& key);
    bool isUserOverride(const std::string& key) const;
    void clearUserOverride(const std::string& key);

    // Phase G4 — persistence for the in-game console. Writes every
    // currently-overridden key to `<sourceDirectory>/_overrides.yaml`
    // (flat `KEY: value`, sorted) so console `set` tuning survives a
    // quit + relaunch. The sidecar is re-applied LAST on every load
    // (see loadDirectory / loadDirectoryPreservingOverrides) so it wins
    // over the base configs. Returns the number of keys written, or -1
    // if the file could not be opened. Const: only reads live state and
    // writes to disk — it never mutates the in-memory maps.
    int saveOverrides() const;
    // Absolute path of the overrides sidecar (`<sourceDirectory>/_overrides.yaml`).
    // Used by the console `save` handler to report where it wrote.
    std::filesystem::path overridesFilePath() const;

    std::vector<std::string> keysFromFile(const std::string& sourceFileStem) const;

private:
    // Phase G4 — apply the `_overrides.yaml` sidecar with LAST-WINS
    // precedence after the base directory pass. Lenient parse (a
    // hand-broken line is skipped, never fatal — a corrupt sidecar must
    // not brick launch, unlike loadFile which throws). Keys already
    // flagged as overrides this session are left untouched so an unsaved
    // in-memory tweak always beats the on-disk value.
    void applyOverridesFile(const std::filesystem::path& filePath);

    std::unordered_map<std::string, ConfigEntry> values;
    std::unordered_set<std::string>              overriddenKeys;
    // Source stems last seen in each loaded directory. Preserving reloads use
    // this to remove keys deleted from an existing file or from a removed file.
    std::unordered_map<std::string, std::unordered_set<std::string>> sourceStemsByDirectory;
    // Phase G5 — set by markAsUserOverride, cleared by clearConfigDirty.
    // A live edit flips this; GameSession consumes it per frame to restyle.
    bool                                         configDirty{false};
    // Phase G4 — the primary config directory, claimed by loadDirectory
    // (never by the preserving reload or the effects-subdir load). Home
    // of the `_overrides.yaml` sidecar that saveOverrides writes.
    std::filesystem::path                        sourceDirectory;
};

}
