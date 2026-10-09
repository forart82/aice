#include "app/App.hpp"

#include "app/AppOptions.hpp"
#include "app/GameSession.hpp"
#include "diagnostics/CrashHandler.hpp"
#include "loaders/ConfigLoader.hpp"
#include "render/VersionOverlay.hpp"

#include <SFML/System/Err.hpp>
#include <SFML/System/Sleep.hpp>
#include <chrono>
#include <iostream>
#include <streambuf>
#include <string>
#include <thread>

namespace dof::app {

namespace {

std::uint64_t timeBasedSeed() {
    using namespace std::chrono;
    return static_cast<std::uint64_t>(duration_cast<nanoseconds>(steady_clock::now().time_since_epoch()).count());
}

// SFML prints internal diagnostics to sf::err(). On an X11 session with no
// input method running, window creation emits a benign one-liner ("Failed to
// create input context for window -- TextEntered event won't be able to return
// unicode") that clutters the terminal at every startup but signals no real
// problem. This line-buffering filter drops exactly that message and forwards
// every other SFML diagnostic through to the original stream unchanged, so real
// errors (shader/context/texture failures) still surface.
class SfmlErrFilter : public std::streambuf {
public:
    explicit SfmlErrFilter(std::streambuf* dest) : dest_(dest) {}

protected:
    int overflow(int ch) override {
        if (ch == std::streambuf::traits_type::eof()) return ch;
        line_ += static_cast<char>(ch);
        if (ch == '\n') flushLine();
        return ch;
    }
    int sync() override {
        if (!line_.empty()) flushLine();
        return dest_ ? dest_->pubsync() : 0;
    }

private:
    void flushLine() {
        if (dest_ && line_.find("Failed to create input context") == std::string::npos) {
            dest_->sputn(line_.data(), static_cast<std::streamsize>(line_.size()));
        }
        line_.clear();
    }
    std::streambuf* dest_;
    std::string     line_;
};

}

int App::run(int argc, char** argv) {
    // Route SFML's diagnostic stream through the benign-warning filter for the
    // whole process lifetime (static so it outlives every sf::err() use).
    static SfmlErrFilter sfmlErrFilter(sf::err().rdbuf());
    sf::err().rdbuf(&sfmlErrFilter);

    AppOptions options;
    try {
        options = parseAppOptions(argc, argv);
    } catch (const std::exception& ex) {
        std::cerr << "[dogmax] argument error: " << ex.what() << "\n";
        return 2;
    }

    if (!options.isSeedExplicit) options.seed = timeBasedSeed();

    // Install the crash handler before GameSession constructs the window and
    // shaders — the most likely place to fault — so a SIGSEGV/SIGABRT there still
    // produces a backtrace naming the build. Config-gated; failure to read the
    // diagnostics config never blocks the game from launching.
    try {
        loaders::ConfigLoader diagnosticsConfig;
        diagnosticsConfig.loadDirectory(options.configDirectory);
        if (diagnosticsConfig.hasKey("CRASH_HANDLER_ENABLED") &&
            diagnosticsConfig.getBool("CRASH_HANDLER_ENABLED")) {
            std::string versionLabel = "unknown";
            try {
                const auto version = render::readVersionNumbers(diagnosticsConfig);
                versionLabel = render::composeVersionString(version.major, version.minor, version.build);
            } catch (const std::exception& ex) {
                // Version files absent — still install with an "unknown" label.
                std::cerr << "[dogmax] version read failed, using \"unknown\": " << ex.what() << "\n";
            }
            diagnostics::installCrashHandler(
                diagnosticsConfig.getString("CRASH_DUMP_DIRECTORY"), versionLabel);
        }
    } catch (const std::exception& ex) {
        std::cerr << "[dogmax] crash handler init skipped: " << ex.what() << "\n";
    }

    try {
        GameSession session(options);
        return session.run();
    } catch (const std::exception& ex) {
        std::cerr << "[dogmax] fatal: " << ex.what() << "\n";
        return 1;
    }
}

}
