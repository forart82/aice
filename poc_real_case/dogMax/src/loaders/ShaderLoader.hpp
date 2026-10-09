#pragma once

#include <filesystem>
#include <memory>
#include <string>
#include <unordered_map>

namespace sf {
class Shader;
}

namespace dof::loaders {

class ShaderLoader {
public:
    ShaderLoader();
    ~ShaderLoader();

    // Prevent copies
    ShaderLoader(const ShaderLoader&) = delete;
    ShaderLoader& operator=(const ShaderLoader&) = delete;

    // Allow moves
    ShaderLoader(ShaderLoader&&) noexcept;
    ShaderLoader& operator=(ShaderLoader&&) noexcept;

    // Compiles a vertex + fragment shader
    void loadShader(const std::string& name, const std::filesystem::path& vertexPath, const std::filesystem::path& fragmentPath);

    // Compiles a fragment-only shader
    void loadShader(const std::string& name, const std::filesystem::path& fragmentPath);

    // Returns if the shader is loaded and available
    bool hasShader(const std::string& name) const;

    // Returns a pointer to the compiled shader if available, or nullptr
    const sf::Shader* getShader(const std::string& name) const;
    sf::Shader* getShader(const std::string& name);

    // Returns if shaders are supported on the current hardware/context
    bool hasSystemSupport() const;

private:
    std::unordered_map<std::string, std::unique_ptr<sf::Shader>> shaders;
    // Support is probed lazily on the first hasSystemSupport() call, not in the
    // constructor: sf::Shader::isAvailable() needs a live GL context and aborts
    // on a truly headless host, so a ShaderLoader that is constructed but never
    // asked for support must never touch GL. Both are mutable because the probe
    // caches its result from inside the const accessor.
    mutable bool isSystemSupported{false};
    mutable bool hasQueriedSupport{false};
};

}
