#pragma once

// Console-cheat tooltip mapper. Pure (no SFML / no rendering): takes the
// live console input string and returns the multi-line help text that
// `ConsoleOverlay` paints above the input bar. Returns an empty string
// when the input does not match any known cheat — render layer hides
// the tooltip in that case.

#include <string>

namespace dof::app {

std::string consoleCheatTooltip(const std::string& input);

}
