#include "app/Console.hpp"

#include "helpers/StringHelper.hpp"
#include "loaders/ConfigLoader.hpp"

#include <algorithm>

namespace dof::app {

namespace {

// Static command set (spec L2960). Kept tiny on purpose — additional
// "future commands" (spec L2977-2984) plug in via the parser later.
// `SpawnWeapon=` / `SpawnEnemy=` / `SpawnDice=` are autocomplete templates —
// user appends a level (1..100) then Enter to spawn at that level.
const std::vector<std::string>& staticCommands() {
    static const std::vector<std::string> all = {
        "all", "save", "config:",
        "SpawnWeapon=", "SpawnEnemy=", "SpawnDice="
    };
    return all;
}

// Case-insensitive contains check. Both arguments are ASCII-folded to lower
// case, then a plain substring search decides the match — the canonical
// casing of the pool entry is preserved for display while the user-typed
// needle matches without regard to case. An empty needle matches anything,
// mirroring std::string::find.
bool containsCaseInsensitive(const std::string& haystack, const std::string& needle) {
    return dof::helpers::toLower(haystack).find(dof::helpers::toLower(needle))
        != std::string::npos;
}

}

Console::Console(int outputLinesMax, int historyMax, int suggestionLimit)
    : outputCap(outputLinesMax),
      historyCap(historyMax),
      suggestionCap(suggestionLimit) {}

void Console::appendInput(char c) {
    inputLine.push_back(c);
    // Typing invalidates any in-flight autocomplete cycle.
    completionCandidates.clear();
    cachedPrefix.clear();
    completionIndex = -1;
    // T-CONSOLE-history-filter — typing also resets the history walk
    // so the next Up re-anchors against the freshly-typed prefix.
    historyCursor      = -1;
    historyWalkActive  = false;
    historyNeedle.clear();
    // Refresh the typing-time dropdown whenever a loader is wired.
    rebuildSuggestionsIfAttached();
}

void Console::appendInput(const std::string& chunk) {
    for (char c : chunk) appendInput(c);
}

void Console::backspace() {
    if (!inputLine.empty()) inputLine.pop_back();
    completionCandidates.clear();
    cachedPrefix.clear();
    completionIndex = -1;
    historyCursor      = -1;
    historyWalkActive  = false;
    historyNeedle.clear();
    rebuildSuggestionsIfAttached();
}

void Console::clearInput() {
    inputLine.clear();
    completionCandidates.clear();
    cachedPrefix.clear();
    completionIndex = -1;
    historyCursor      = -1;
    historyWalkActive  = false;
    historyNeedle.clear();
    // Empty input has no typing-time suggestions either.
    suggestionList.clear();
    suggestionCursor = -1;
}

const std::string& Console::input() const { return inputLine; }

ConsoleCommand Console::submit(dof::loaders::ConfigLoader& loader) {
    const std::string line = inputLine;
    clearInput();
    return dispatchLine(line, loader);
}

ConsoleCommand Console::dispatchLine(const std::string& line, dof::loaders::ConfigLoader& loader) {
    const auto cmd = parseConsoleCommand(line, loader.getInt("HERO_MAX_LEVEL"));
    // Spec §Output Style L2971 — every input line is echoed with the chevron prefix.
    pushOutput(ConsoleLineKind::Input, cmd.raw);
    if (!cmd.raw.empty()) pushToHistory(cmd.raw);
    for (auto& replyLine : formatCommandResponse(cmd, loader)) {
        pushOutput(replyLine.kind, std::move(replyLine.text));
    }
    return cmd;
}

void Console::recallPrevious() {
    if (commandHistory.empty()) return;
    // First Up after a typing burst captures the current input as the
    // filter needle AND the buffer to restore if Down walks past the
    // newest match (zsh-style history-substring-search).
    if (!historyWalkActive) {
        historyNeedle     = inputLine;
        historyWalkActive = true;
        historyCursor     = -1;
    }
    const int next = stepHistoryWalk(commandHistory, historyCursor,
                                      historyNeedle, inputLine,
                                      /*isBackward=*/true);
    if (next == -1) {
        // No older match — stick at the current line (no-op when no
        // walk has started yet either).
        return;
    }
    historyCursor = next;
    inputLine     = commandHistory[static_cast<std::size_t>(historyCursor)];
    completionCandidates.clear();
    cachedPrefix.clear();
    completionIndex = -1;
    rebuildSuggestionsIfAttached();
}

void Console::recallNext() {
    if (!historyWalkActive || historyCursor == -1) return;
    const int next = stepHistoryWalk(commandHistory, historyCursor,
                                      historyNeedle, inputLine,
                                      /*isBackward=*/false);
    if (next == -1) {
        // Walked past the newest match — restore whatever the user was
        // typing before they pressed Up the first time.
        historyCursor     = -1;
        historyWalkActive = false;
        inputLine         = historyNeedle;
        historyNeedle.clear();
    } else {
        historyCursor = next;
        inputLine     = commandHistory[static_cast<std::size_t>(historyCursor)];
    }
    completionCandidates.clear();
    cachedPrefix.clear();
    completionIndex = -1;
    rebuildSuggestionsIfAttached();
}

int stepHistoryWalk(const std::deque<std::string>& historyEntries,
                    int currentCursor,
                    const std::string& needle,
                    const std::string& currentInput,
                    bool isBackward) {
    const int n = static_cast<int>(historyEntries.size());
    if (n == 0) return -1;
    int i = currentCursor;
    if (isBackward) {
        // Up: start from the slot just before the cursor (or the
        // newest entry if the walk hasn't begun yet).
        i = (currentCursor == -1) ? (n - 1) : (currentCursor - 1);
        for (; i >= 0; --i) {
            const auto& entry = historyEntries[static_cast<std::size_t>(i)];
            if (entry == currentInput) continue;
            if (containsCaseInsensitive(entry, needle)) return i;
        }
        return -1;
    }
    // Down: walk forward from the slot just after the cursor.
    if (currentCursor == -1) return -1;
    for (i = currentCursor + 1; i < n; ++i) {
        const auto& entry = historyEntries[static_cast<std::size_t>(i)];
        if (entry == currentInput) continue;
        if (containsCaseInsensitive(entry, needle)) return i;
    }
    return -1;
}

const std::deque<std::string>& Console::history() const { return commandHistory; }

void Console::cycleAutocomplete(dof::loaders::ConfigLoader& loader, bool isReverse) {
    // Re-build candidates whenever the cached needle is no longer
    // present in the live input line (case-insensitive contains) or on
    // the first call. Cycling is anchored to whatever the user typed at
    // the moment the cycle started; while the typed needle still
    // appears anywhere inside the current input the cycle can advance.
    if (completionCandidates.empty() || !containsCaseInsensitive(inputLine, cachedPrefix)
        || completionIndex == -1) {
        cachedPrefix = inputLine;
        completionCandidates = buildAutocompleteCandidates(loader, cachedPrefix);
        completionIndex = -1;
    }
    if (completionCandidates.empty()) return;
    const int n = static_cast<int>(completionCandidates.size());
    completionIndex = isReverse
        ? ((completionIndex <= 0) ? (n - 1) : (completionIndex - 1))
        : ((completionIndex + 1) % n);
    inputLine = completionCandidates[static_cast<std::size_t>(completionIndex)];
}

int Console::autocompleteIndex() const { return completionIndex; }

void Console::refreshSuggestions(const dof::loaders::ConfigLoader& loader) {
    suggestionList = buildSuggestionList(loader, inputLine, suggestionCap);
    suggestionCursor = -1;
}

const std::vector<std::string>& Console::suggestions() const { return suggestionList; }

int Console::suggestionIndex() const { return suggestionCursor; }

void Console::moveSuggestionNext() {
    if (suggestionList.empty()) return;
    const int n = static_cast<int>(suggestionList.size());
    suggestionCursor = (suggestionCursor < 0)
        ? 0
        : (suggestionCursor + 1) % n;
}

void Console::moveSuggestionPrevious() {
    if (suggestionList.empty()) return;
    const int n = static_cast<int>(suggestionList.size());
    suggestionCursor = (suggestionCursor < 0)
        ? (n - 1)
        : ((suggestionCursor == 0) ? (n - 1) : (suggestionCursor - 1));
}

void Console::clearSuggestions() {
    suggestionList.clear();
    suggestionCursor = -1;
}

bool Console::acceptSelectedSuggestion() {
    if (suggestionCursor < 0 || suggestionCursor >= static_cast<int>(suggestionList.size())) {
        return false;
    }
    inputLine = suggestionList[static_cast<std::size_t>(suggestionCursor)];
    // After acceptance the dropdown is dismissed; the user can keep
    // typing or hit Tab to dive back into the cycle path.
    suggestionList.clear();
    suggestionCursor = -1;
    completionCandidates.clear();
    cachedPrefix.clear();
    completionIndex = -1;
    return true;
}

void Console::attachLoader(const dof::loaders::ConfigLoader& loader) {
    attachedLoader = &loader;
    // Initialise the dropdown immediately so the first frame after
    // attaching reflects the current `inputLine`.
    rebuildSuggestionsIfAttached();
}

const std::deque<ConsoleLine>& Console::outputLines() const { return output; }

void Console::clearOutput() {
    output.clear();
    outputScrollOffset = 0;
}

void Console::log(ConsoleLineKind kind, std::string text) {
    pushOutput(kind, std::move(text));
}

int Console::scrollOffset() const { return outputScrollOffset; }

void Console::scrollBy(int lineDelta) {
    // Positive delta scrolls toward older lines; negative toward newer.
    // Clamp so the visible window can neither go past the bottom (0)
    // nor leave the entire log scrolled off the top.
    outputScrollOffset += lineDelta;
    const int maxOffset = std::max(0, static_cast<int>(output.size()) - 1);
    if (outputScrollOffset < 0)         outputScrollOffset = 0;
    else if (outputScrollOffset > maxOffset) outputScrollOffset = maxOffset;
}

void Console::scrollToBottom() { outputScrollOffset = 0; }

void Console::pushOutput(ConsoleLineKind kind, std::string text) {
    output.push_back(ConsoleLine{kind, std::move(text)});
    while (static_cast<int>(output.size()) > outputCap) output.pop_front();
    // New output snaps the visible window back to the bottom so the
    // latest line is always shown by default. The user explicitly
    // scrolls up via wheel / PgUp to inspect history.
    outputScrollOffset = 0;
}

void Console::pushToHistory(const std::string& command) {
    // Spec §History L2965 — Up arrow walks back; identical consecutive
    // entries are deduped so spamming the same lookup doesn't bloat
    // the cap. (Bash / zsh-style behaviour.)
    if (!commandHistory.empty() && commandHistory.back() == command) return;
    commandHistory.push_back(command);
    while (static_cast<int>(commandHistory.size()) > historyCap) {
        commandHistory.pop_front();
    }
}

void Console::rebuildSuggestionsIfAttached() {
    if (!attachedLoader) return;
    refreshSuggestions(*attachedLoader);
}

std::vector<std::string> buildAutocompleteCandidates(const dof::loaders::ConfigLoader& loader,
                                                      const std::string& prefix) {
    // Semantics: case-insensitive contains match (user types any
    // substring of the canonical entry, in any case). The canonical
    // casing of the pool entry is preserved verbatim in the result so
    // the dropdown displays / inserts the proper spelling.
    std::vector<std::string> out;
    for (const auto& staticCmd : staticCommands()) {
        if (containsCaseInsensitive(staticCmd, prefix)) out.push_back(staticCmd);
    }
    for (const auto& [key, entry] : loader.entries()) {
        (void)entry;
        if (containsCaseInsensitive(key, prefix)) out.push_back(key);
    }
    std::sort(out.begin(), out.end());
    out.erase(std::unique(out.begin(), out.end()), out.end());
    return out;
}

std::vector<std::string> buildSuggestionList(const dof::loaders::ConfigLoader& loader,
                                              const std::string& prefix,
                                              int limit) {
    if (limit <= 0) return {};
    // Empty input → empty dropdown so the user sees suggestions only
    // after they start typing (matches zsh-style auto-suggestion UX).
    if (prefix.empty()) return {};
    auto full = buildAutocompleteCandidates(loader, prefix);
    if (static_cast<int>(full.size()) > limit) {
        full.resize(static_cast<std::size_t>(limit));
    }
    return full;
}

std::vector<ConsoleLine> formatCommandResponse(const ConsoleCommand& cmd,
                                                 dof::loaders::ConfigLoader& loader) {
    std::vector<ConsoleLine> lines;
    switch (cmd.kind) {
        case ConsoleCommandKind::Empty:
            return lines;
        case ConsoleCommandKind::Invalid:
            lines.push_back({ConsoleLineKind::Error, "invalid command: " + cmd.raw});
            return lines;
        case ConsoleCommandKind::ListAll: {
            std::vector<std::string> keys;
            keys.reserve(loader.entries().size());
            for (const auto& [k, entry] : loader.entries()) {
                (void)entry;
                keys.push_back(k);
            }
            std::sort(keys.begin(), keys.end());
            for (const auto& k : keys) {
                lines.push_back({ConsoleLineKind::Output, k + " = " + loader.getString(k)});
            }
            return lines;
        }
        case ConsoleCommandKind::ListSection: {
            auto keys = loader.keysFromFile(cmd.section);
            if (keys.empty()) {
                lines.push_back({ConsoleLineKind::Error, "no keys found in config:" + cmd.section});
                return lines;
            }
            std::sort(keys.begin(), keys.end());
            for (const auto& k : keys) {
                lines.push_back({ConsoleLineKind::Output, k + " = " + loader.getString(k)});
            }
            return lines;
        }
        case ConsoleCommandKind::GetKey: {
            // Normalize to uppercase, same as SetKey below — all config
            // keys are stored uppercase, and hasKey/entries() do a plain
            // case-sensitive lookup, so a lowercase get (e.g. "window_width")
            // must map to WINDOW_WIDTH the same way a lowercase set does.
            std::string upperKey;
            upperKey.reserve(cmd.key.size());
            for (char c : cmd.key)
                upperKey.push_back(c >= 'a' && c <= 'z'
                    ? static_cast<char>(c - ('a' - 'A')) : c);
            if (!loader.hasKey(upperKey)) {
                lines.push_back({ConsoleLineKind::Error, "unknown key: " + cmd.key});
                return lines;
            }
            // ConfigLoader collapses duplicates today (one entry per key),
            // so qualified `section.KEY` reads return the same value as
            // bare `KEY`. Surface the section in the output for clarity.
            const auto& entry = loader.entries().at(upperKey);
            std::string echo;
            if (!cmd.section.empty()) echo = cmd.section + "." + upperKey + " = " + entry.value;
            else if (!entry.sourceFile.empty())
                echo = entry.sourceFile + "." + upperKey + " = " + entry.value;
            else echo = upperKey + " = " + entry.value;
            lines.push_back({ConsoleLineKind::Output, std::move(echo)});
            return lines;
        }
        case ConsoleCommandKind::SetKey: {
            // Normalize to uppercase: all .config keys are uppercase by
            // convention, so `enemy_spawn_interval=0.2` must map to
            // ENEMY_SPAWN_INTERVAL or the setRaw creates a phantom entry.
            std::string upperKey;
            upperKey.reserve(cmd.key.size());
            for (char c : cmd.key)
                upperKey.push_back(c >= 'a' && c <= 'z'
                    ? static_cast<char>(c - ('a' - 'A')) : c);
            if (!loader.hasKey(upperKey)) {
                lines.push_back({ConsoleLineKind::Error,
                                 "unknown key: " + cmd.key});
                return lines;
            }
            // Spec §Console L2941-2944: set value in memory; most
            // consumers re-read config every frame, so the change
            // applies instantly. We deliberately do NOT call
            // `ConfigLoader::loadDirectory` (which would clobber the
            // value). The edit is session-local until the user runs the
            // `save` verb (Phase G4), which persists every override to
            // the `_overrides.yaml` sidecar.
            // Gate on the same numeric-shape validator the Config-tab edit
            // path uses (GameSession_Input.cpp). Without this a `set KEY=abc`
            // on an int/float key could be `save`d into _overrides.yaml and
            // then throw in getInt/getFloat on the NEXT launch — bricking
            // startup until the sidecar is manually deleted.
            if (!loader.isOverrideValueValid(upperKey, cmd.value)) {
                lines.push_back({ConsoleLineKind::Error,
                    "invalid value for " + upperKey + " (wrong numeric type): " + cmd.value});
                return lines;
            }
            loader.setRaw(upperKey, cmd.value);
            // card-mpl8dyop — flag the key as user-overridden so
            // Ctrl+R's `loadDirectoryPreservingOverrides` skips it
            // on reload. The override persists for the lifetime of
            // the process; a fresh launch starts with no overrides.
            loader.markAsUserOverride(upperKey);
            lines.push_back({ConsoleLineKind::Success,
                             "set " + upperKey + " = " + cmd.value});
            return lines;
        }
        case ConsoleCommandKind::Save: {
            // Phase G4 — persist every console override to the
            // `_overrides.yaml` sidecar so the tuning survives a quit +
            // relaunch. Report the count and the destination path; a
            // negative count means the file could not be written.
            const int written = loader.saveOverrides();
            if (written < 0) {
                lines.push_back({ConsoleLineKind::Error,
                                 "save failed: could not write "
                                 + loader.overridesFilePath().string()});
            } else {
                lines.push_back({ConsoleLineKind::Success,
                                 "saved " + std::to_string(written)
                                 + " override(s) to " + loader.overridesFilePath().string()});
            }
            return lines;
        }
        case ConsoleCommandKind::SpawnWeapon:
        case ConsoleCommandKind::SpawnEnemy:
        case ConsoleCommandKind::SpawnDice:
            // The actual spawn is performed by the owning GameSession after
            // `Console::submit` returns the parsed command (Console has no
            // World / Maker refs). GameSession pushes the "spawned …"
            // Success line via `Console::log` once the entity lands.
            return lines;
    }
    return lines;
}

}
