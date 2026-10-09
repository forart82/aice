#pragma once

#include "entities/EnemyTemplate.hpp"

#include <filesystem>
#include <string>

namespace dof::render {

// Serializes `tmpl` to a flat YAML file at `path`. Format: one
// KEY: value line per field; identical to the files the loader reads.
// Throws std::runtime_error if the file cannot be written.
void writeEnemyTemplate(const dof::entities::EnemyTemplate& tmpl,
                        const std::filesystem::path& path);

// Convenience: same as above but also copies the written file to
// `buildPath` so the build dir picks up the change without rebuild.
void writeEnemyTemplateAndSync(const dof::entities::EnemyTemplate& tmpl,
                               const std::filesystem::path& sourcePath,
                               const std::filesystem::path& buildPath);

} // namespace dof::render
