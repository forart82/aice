#include "helpers/StringHelper.hpp"

#include <algorithm>
#include <cctype>

namespace dof::helpers {

std::string trim(std::string_view input) {
    size_t begin = 0;
    while (begin < input.size() && std::isspace(static_cast<unsigned char>(input[begin]))) ++begin;
    size_t end = input.size();
    while (end > begin && std::isspace(static_cast<unsigned char>(input[end - 1]))) --end;
    return std::string(input.substr(begin, end - begin));
}

std::vector<std::string> split(std::string_view input, char delimiter) {
    std::vector<std::string> tokens;
    std::string current;
    for (char character : input) {
        if (character == delimiter) {
            tokens.push_back(current);
            current.clear();
        } else {
            current.push_back(character);
        }
    }
    tokens.push_back(current);
    return tokens;
}

bool startsWith(std::string_view input, std::string_view prefix) {
    if (prefix.size() > input.size()) return false;
    return input.compare(0, prefix.size(), prefix) == 0;
}

bool endsWith(std::string_view input, std::string_view suffix) {
    if (suffix.size() > input.size()) return false;
    return input.compare(input.size() - suffix.size(), suffix.size(), suffix) == 0;
}

std::string toLower(std::string_view input) {
    std::string lower;
    lower.reserve(input.size());
    for (char character : input) {
        lower.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(character))));
    }
    return lower;
}

}
