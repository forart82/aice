#pragma once

#include "entities/EnemyTemplate.hpp"

#include <filesystem>
#include <map>
#include <string>
#include <vector>

namespace dof::loaders {

// Parses one flat-YAML enemy file into an entities::EnemyTemplate.
//
// Each enemy file is self-contained and reuses the same key names
// (ENEMY_BODY_SHAPE, ENEMY_LAYER_00_SHADER, ...), so the files CANNOT
// share the global ConfigLoader registry — every file is parsed into
// its own throwaway ConfigLoader instance here. Per-tier overrides are
// resolved at load time: keys prefixed `ENEMY_UNCOMMON_*` / `ENEMY_RARE_*`
// override their `ENEMY_*` base; an absent override inherits the base.
entities::EnemyTemplate loadEnemyTemplateFile(const std::filesystem::path& filePath);

// In-memory registry of every enemy template under a directory, keyed
// by the file stem (== ENEMY_TYPE_ID). Built by the spawner/render path
// and reloaded by the editor on save so live enemies pick up edits.
class EnemyTemplateRegistry {
public:
    // Loads every *.yaml directly under `directory` (non-recursive),
    // replacing any previously loaded templates. Throws if the
    // directory is missing.
    void loadDirectory(const std::filesystem::path& directory);

    // Inserts or replaces the template with matching id. Used by the
    // editor to push live edits so WorldRenderer picks them up immediately.
    void put(const entities::EnemyTemplate& tmpl);

    bool                          has(const std::string& id) const;
    const entities::EnemyTemplate& get(const std::string& id) const;

    // Looks up the template that owns a spawn-taxonomy kind: the first
    // template whose `specialKind` matches. Returns nullptr if none
    // declares that kind. `None` resolves to the regular template.
    const entities::EnemyTemplate* findBySpecialKind(entities::SpecialEnemyKind kind) const;

    std::vector<std::string> ids() const;
    std::size_t              size() const { return templates.size(); }

private:
    std::map<std::string, entities::EnemyTemplate> templates;
};

}
