#include "app/App.hpp"

#include <exception>
#include <iostream>

// Top-level guard: any startup/runtime failure (e.g. a missing UI font, an
// unreadable config, a RenderTexture allocation error) propagates here as an
// exception. Without this catch the process aborts via std::terminate with no
// diagnostic — which is exactly how a fresh clone used to "crash on launch" when
// the font asset could not be opened. Report the reason and exit non-zero.
int main(int argc, char** argv) {
    try {
        dof::app::App app;
        return app.run(argc, argv);
    } catch (const std::exception& error) {
        std::cerr << "dogmax: fatal error during startup: " << error.what() << '\n'
                  << "hint: verify UI_FONT_PATH in configs/ui.yaml and that the "
                     "assets/ directory sits next to the executable.\n";
        return 1;
    }
}
