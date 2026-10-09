#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace dof::helpers {

std::string trim(std::string_view input);
std::vector<std::string> split(std::string_view input, char delimiter);
bool startsWith(std::string_view input, std::string_view prefix);
bool endsWith(std::string_view input, std::string_view suffix);
std::string toLower(std::string_view input);

}
