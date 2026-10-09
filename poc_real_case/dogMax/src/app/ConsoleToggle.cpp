#include "app/ConsoleToggle.hpp"

namespace dof::app {

CaretToggleOutcome toggleConsoleOnCaret(unsigned int unicode, bool wasVisible) {
    if (unicode != 0x5E) return {false, wasVisible};
    return {true, !wasVisible};
}

}
