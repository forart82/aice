#include "app/AppOptions.hpp"

#include "helpers/StringHelper.hpp"

#include <cstring>
#include <cmath>
#include <filesystem>
#include <limits>
#include <stdexcept>
#include <string>

namespace dof::app {

namespace {

bool consumeValue(const std::string& argument, const char* prefix, std::string& output) {
    const size_t prefixLength = std::strlen(prefix);
    if (argument.size() <= prefixLength) return false;
    if (argument.compare(0, prefixLength, prefix) != 0) return false;
    if (argument[prefixLength] != '=') return false;
    output = argument.substr(prefixLength + 1);
    return true;
}

float parseFiniteFloat(const std::string& text, const char* optionName) {
    try {
        std::size_t consumed = 0;
        const float value = std::stof(text, &consumed);
        if (consumed != text.size() || !std::isfinite(value)) {
            throw std::runtime_error("not a finite complete number");
        }
        return value;
    } catch (const std::exception&) {
        throw std::runtime_error(std::string(optionName)
                                 + " needs a finite numeric value");
    }
}

int parseCompleteInt(const std::string& text, const char* optionName) {
    try {
        std::size_t consumed = 0;
        const long long value = std::stoll(text, &consumed);
        if (consumed != text.size()
            || value < std::numeric_limits<int>::min()
            || value > std::numeric_limits<int>::max()) {
            throw std::runtime_error("not a complete int");
        }
        return static_cast<int>(value);
    } catch (const std::exception&) {
        throw std::runtime_error(std::string(optionName) + " needs an integer value");
    }
}

std::uint64_t parseCompleteSeed(const std::string& text) {
    if (text.empty()) throw std::runtime_error("--seed needs an unsigned integer value");
    for (const char character : text) {
        if (character < '0' || character > '9') {
            throw std::runtime_error("--seed needs an unsigned integer value");
        }
    }
    try {
        std::size_t consumed = 0;
        const auto value = std::stoull(text, &consumed);
        if (consumed != text.size()) {
            throw std::runtime_error("not a complete seed");
        }
        return value;
    } catch (const std::exception&) {
        throw std::runtime_error("--seed needs an unsigned integer value");
    }
}

}

AppOptions parseAppOptions(int argc, char** argv) {
    AppOptions options;
    // Resolve configDirectory relative to the executable so the game finds
    // build/configs/ regardless of the working directory (e.g. ./build/dogmax
    // run from the project root still reads build/configs/, not source configs/).
    if (argc > 0 && argv[0] && argv[0][0] != '\0') {
        const auto parent = std::filesystem::path(argv[0]).parent_path();
        if (!parent.empty()) {
            options.configDirectory = (parent / "configs").string();
        }
    }
    for (int i = 1; i < argc; ++i) {
        const std::string token = argv[i];
        if (token == "--headless") {
            options.isHeadless = true;
            continue;
        }
        if (token == "--offscreen") {
            options.isOffscreen = true;
            continue;
        }
        std::string value;
        if (consumeValue(token, "--self-test-duration", value)) {
            options.selfTestDurationSeconds = parseFiniteFloat(value, "--self-test-duration");
            continue;
        }
        if (token == "--self-test-move") {
            options.isSelfTestMoving = true;
            continue;
        }
        if (token == "--world-editor") {
            options.isWorldEditorOpen = true;
            continue;
        }
        if (token == "--world-editor-save-on-start") {
            options.isWorldEditorOpen = true;
            options.isWorldEditorSaveOnStart = true;
            continue;
        }
        if (consumeValue(token, "--camera-zoom", value)) {
            options.cameraZoomOverride = parseFiniteFloat(value, "--camera-zoom");
            if (options.cameraZoomOverride <= 0.0f) {
                throw std::runtime_error("--camera-zoom must be > 0");
            }
            continue;
        }
        if (consumeValue(token, "--hero-position", value)) {
            const auto separator = value.find(',');
            if (separator == std::string::npos
                || value.find(',', separator + 1) != std::string::npos) {
                throw std::runtime_error("--hero-position needs x,y");
            }
            options.heroPositionOverrideX = parseFiniteFloat(
                value.substr(0, separator), "--hero-position x");
            options.heroPositionOverrideY = parseFiniteFloat(
                value.substr(separator + 1), "--hero-position y");
            options.hasHeroPositionOverride = true;
            continue;
        }
        if (consumeValue(token, "--seed", value)) {
            options.seed = parseCompleteSeed(value);
            options.isSeedExplicit = true;
            continue;
        }
        if (consumeValue(token, "--config-dir", value)) {
            options.configDirectory = value;
            continue;
        }
        if (consumeValue(token, "--screenshot-path", value)) {
            options.screenshotPath = value;
            continue;
        }
        if (consumeValue(token, "--screenshot-delay", value)) {
            options.screenshotDelaySeconds = parseFiniteFloat(value, "--screenshot-delay");
            continue;
        }
        if (consumeValue(token, "--perf-enemies", value)) {
            options.performanceEnemyCount = parseCompleteInt(value, "--perf-enemies");
            if (options.performanceEnemyCount < 0) {
                throw std::runtime_error("--perf-enemies must be >= 0");
            }
            continue;
        }
        if (consumeValue(token, "--perf-report-path", value)) {
            options.performanceReportPath = value;
            continue;
        }
        if (consumeValue(token, "--attack-showcase-weapon", value)) {
            options.attackShowcaseWeapon = value;
            continue;
        }
        throw std::runtime_error("Unknown command-line argument: " + token);
    }
    return options;
}

}
