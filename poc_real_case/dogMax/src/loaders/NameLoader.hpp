#pragma once

#include <filesystem>
#include <string>
#include <unordered_map>
#include <vector>

namespace dof::loaders {

class NameLoader {
public:
    void loadDirectory(const std::filesystem::path& directory);
    void loadFile(const std::filesystem::path& filePath);

    bool                            hasPool(const std::string& poolName) const;
    const std::vector<std::string>& pool(const std::string& poolName) const;
    std::vector<std::string>        poolNames() const;
    std::size_t                     poolCount() const;

private:
    std::unordered_map<std::string, std::vector<std::string>> pools;
};

}
