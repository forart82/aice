#include "loaders/ShaderLoader.hpp"

#include <SFML/Graphics/Shader.hpp>
#include <stdexcept>

namespace dof::loaders {

// Deliberately does NOT probe sf::Shader::isAvailable() here — that GL query is
// deferred to the first hasSystemSupport() call so headless construction (before
// any --headless branching can run) never touches GL. isSystemSupported stays
// default-initialized to false until then.
ShaderLoader::ShaderLoader() = default;

ShaderLoader::~ShaderLoader() = default;

ShaderLoader::ShaderLoader(ShaderLoader&&) noexcept = default;
ShaderLoader& ShaderLoader::operator=(ShaderLoader&&) noexcept = default;

void ShaderLoader::loadShader(const std::string& name, const std::filesystem::path& vertexPath, const std::filesystem::path& fragmentPath) {
    if (!std::filesystem::exists(vertexPath)) {
        throw std::runtime_error("ShaderLoader: vertex shader file not found: " + vertexPath.string());
    }
    if (!std::filesystem::exists(fragmentPath)) {
        throw std::runtime_error("ShaderLoader: fragment shader file not found: " + fragmentPath.string());
    }

    if (!isSystemSupported) {
        return;
    }

    auto shader = std::make_unique<sf::Shader>();
    if (!shader->loadFromFile(vertexPath.string(), fragmentPath.string())) {
        throw std::runtime_error("ShaderLoader: failed to compile shader: " + name + " (" + vertexPath.string() + ", " + fragmentPath.string() + ")");
    }
    shaders[name] = std::move(shader);
}

void ShaderLoader::loadShader(const std::string& name, const std::filesystem::path& fragmentPath) {
    if (!std::filesystem::exists(fragmentPath)) {
        throw std::runtime_error("ShaderLoader: fragment shader file not found: " + fragmentPath.string());
    }

    if (!isSystemSupported) {
        return;
    }

    auto shader = std::make_unique<sf::Shader>();
    if (!shader->loadFromFile(fragmentPath.string(), sf::Shader::Type::Fragment)) {
        throw std::runtime_error("ShaderLoader: failed to compile shader: " + name + " (" + fragmentPath.string() + ")");
    }
    shaders[name] = std::move(shader);
}

bool ShaderLoader::hasShader(const std::string& name) const {
    return shaders.find(name) != shaders.end();
}

const sf::Shader* ShaderLoader::getShader(const std::string& name) const {
    const auto it = shaders.find(name);
    if (it != shaders.end()) {
        return it->second.get();
    }
    return nullptr;
}

sf::Shader* ShaderLoader::getShader(const std::string& name) {
    auto it = shaders.find(name);
    if (it != shaders.end()) {
        return it->second.get();
    }
    return nullptr;
}

bool ShaderLoader::hasSystemSupport() const {
    // Lazy one-time GL probe: isAvailable() needs a GL context and aborts on a
    // truly headless host, so it runs only the first time support is asked for
    // and the result is cached for every subsequent call.
    if (!hasQueriedSupport) {
        isSystemSupported = sf::Shader::isAvailable();
        hasQueriedSupport = true;
    }
    return isSystemSupported;
}

}
