#include "loaders/NameLoader.hpp"

#include "helpers/StringHelper.hpp"

#include <fstream>
#include <stdexcept>

namespace dof::loaders {

void NameLoader::loadDirectory(const std::filesystem::path& directory) {
    if (!std::filesystem::exists(directory) || !std::filesystem::is_directory(directory)) {
        throw std::runtime_error("NameLoader: directory not found: " + directory.string());
    }
    pools.clear();
    for (const auto& entry : std::filesystem::directory_iterator(directory)) {
        if (entry.is_regular_file() && entry.path().extension() == ".names") {
            loadFile(entry.path());
        }
    }
}

void NameLoader::loadFile(const std::filesystem::path& filePath) {
    std::ifstream stream(filePath);
    if (!stream.is_open()) {
        throw std::runtime_error("NameLoader: cannot open " + filePath.string());
    }
    const std::string poolName = filePath.stem().string();
    std::vector<std::string> entries;
    std::string line;
    while (std::getline(stream, line)) {
        const std::string stripped = dof::helpers::trim(line);
        if (stripped.empty() || stripped.front() == '#') continue;
        entries.push_back(stripped);
    }
    if (entries.empty()) {
        throw std::runtime_error("NameLoader: empty pool in " + filePath.string());
    }
    pools[poolName] = std::move(entries);
}

bool NameLoader::hasPool(const std::string& poolName) const {
    return pools.find(poolName) != pools.end();
}

const std::vector<std::string>& NameLoader::pool(const std::string& poolName) const {
    const auto it = pools.find(poolName);
    if (it == pools.end()) {
        throw std::runtime_error("NameLoader: missing pool: " + poolName);
    }
    return it->second;
}

std::vector<std::string> NameLoader::poolNames() const {
    std::vector<std::string> out;
    out.reserve(pools.size());
    for (const auto& [key, _] : pools) out.push_back(key);
    return out;
}

std::size_t NameLoader::poolCount() const { return pools.size(); }

}
