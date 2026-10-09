#pragma once

// Spec §Console L2891-2987 — in-game developer console state.
//
// Pure C++ (no SFML in the model): owns the input-line buffer, the
// scrollback log, command history, the Tab-cycle autocomplete cursor,
// AND the typing-time suggestion list that feeds the dropdown rendered
// by `render::ConsoleOverlay`. Rendering lives in `ConsoleOverlay` —
// this module is what the keyboard drives. The parser
// itself lives in `ConsoleCommand` so the grammar can be unit-tested in
// isolation.

#include "app/ConsoleCommand.hpp"

#include <deque>
#include <string>
#include <vector>

namespace dof::loaders { class ConfigLoader; }

namespace dof::app {

enum class ConsoleLineKind { Input, Output, Error, Success };

struct ConsoleLine {
    ConsoleLineKind kind{ConsoleLineKind::Output};
    std::string     text;
};

// Cap on the number of suggestions surfaced in the typing-time dropdown
// (spec §Autocomplete L2970-2976 — eight rows is enough to read at a
// glance without dwarfing the input line). The cap is a config-driven
// value held by `ConsoleOverlay`; the Console model exposes a separate
// helper so unit tests can drive the same cap without standing up the
// renderer.
constexpr int kDefaultSuggestionLimit = 8;

class Console {
public:
    // outputLinesMax + historyMax come from `debug.yaml`
    // (CONSOLE_OUTPUT_LINES_MAX, CONSOLE_HISTORY_MAX). suggestionLimit
    // defaults to `kDefaultSuggestionLimit` but stays parameterised so
    // tests can pin a smaller cap without touching debug.yaml.
    Console(int outputLinesMax, int historyMax,
            int suggestionLimit = kDefaultSuggestionLimit);

    // --- input-line editing (driven by keyboard events) ---
    void  appendInput(char c);
    void  appendInput(const std::string& chunk);
    void  backspace();
    void  clearInput();
    const std::string& input() const;

    // Dispatch the current input line against `loader` and push the
    // result into the scrollback log. Also stores the command in
    // history. Returns the parsed command (mostly useful for tests).
    ConsoleCommand submit(dof::loaders::ConfigLoader& loader);

    // Dispatch an arbitrary line directly against `loader`, bypassing
    // the input buffer (no need to append + submit keystrokes).
    ConsoleCommand dispatchLine(const std::string& line, dof::loaders::ConfigLoader& loader);

    // --- history navigation (Up/Down arrows) ---
    //
    // T-CONSOLE-history-filter: when the user has typed a non-empty
    // input, only history lines that contain the input as a
    // case-insensitive substring are eligible (same semantics as the
    // typing-time autocomplete dropdown). With an empty input every
    // history line is eligible. A history line that exactly equals the
    // current input is skipped so Up never produces a no-op replay.
    // Typing or backspacing resets the walk anchor; the next Up starts
    // from the most-recent match for the freshly-typed prefix. Down
    // past the newest match restores whatever the user was typing
    // before they started walking.
    void recallPrevious();   // walks back through matching history entries
    void recallNext();       // walks forward; restores typed-prefix at end
    const std::deque<std::string>& history() const;

    // --- Tab cycle autocomplete (spec §Autocomplete L2972-2974) ---
    // Cycles candidates that prefix-match the current `input()`.
    // Candidates = every config key from `loader` + static commands.
    // Successive calls cycle; calling with a fresh prefix restarts.
    void cycleAutocomplete(dof::loaders::ConfigLoader& loader, bool isReverse);
    int  autocompleteIndex() const;          // -1 = no active cycle

    // --- Typing-time suggestion dropdown ---
    //
    // Independent of the Tab-cycle state above so the existing
    // `cycleAutocomplete` behaviour (Tab mutates input) keeps working
    // for the unit tests while the dropdown
    // operates purely as a visual + arrow-key navigation surface.
    //
    // `refreshSuggestions` rebuilds the list from the current `input()`
    // (capped to `kDefaultSuggestionLimit`). `appendInput` / `backspace`
    // call it automatically when a loader is wired via `attachLoader`.
    // Tests that drive Console without a live loader call it directly.
    void refreshSuggestions(const dof::loaders::ConfigLoader& loader);
    const std::vector<std::string>& suggestions() const;
    int suggestionIndex() const;             // -1 = no row selected
    void moveSuggestionNext();
    void moveSuggestionPrevious();
    void clearSuggestions();
    // Replace the input line with the currently-selected suggestion.
    // No-op when `suggestionIndex() < 0`. Returns true when the input
    // was mutated so the caller can decide whether to dismiss the
    // dropdown next frame.
    bool acceptSelectedSuggestion();

    // Optional loader pointer — when set, `appendInput` / `backspace`
    // auto-refresh the suggestion list so the dropdown stays in sync
    // with the typed text without an explicit callback from the
    // renderer. Stored as a raw pointer (non-owning); the caller is
    // responsible for keeping the loader alive for the Console's
    // lifetime.
    void attachLoader(const dof::loaders::ConfigLoader& loader);

    // --- scrollback log access ---
    const std::deque<ConsoleLine>& outputLines() const;
    void clearOutput();

    // Public hook for non-Console actors (GameSession's SpawnWeapon /
    // SpawnEnemy / SpawnDice dispatchers) to push a confirmation / error line
    // into the scrollback log without going through `submit`. Mirrors
    // the private `pushOutput` but keeps the log-cap invariants intact.
    void log(ConsoleLineKind kind, std::string text);

    // --- output scrollback offset (card-mpkd92tu) ---
    //
    // 0 = newest line anchored at the bottom of the output area (the
    // default behaviour). Each unit of offset shifts the visible window
    // one line further back into history; the renderer skips the first
    // `scrollOffset` lines when iterating the deque from newest. The
    // offset is clamped against the current scrollback length on every
    // request so wheel events that overshoot the top of the log stop
    // cleanly. New output (any `pushOutput` call) snaps the offset back
    // to 0 so the latest line is always visible by default — the user
    // explicitly scrolls up to inspect history.
    int  scrollOffset() const;
    void scrollBy(int lineDelta);
    void scrollToBottom();

private:
    void pushOutput(ConsoleLineKind kind, std::string text);
    void pushToHistory(const std::string& command);
    void rebuildSuggestionsIfAttached();

    int outputCap;
    int historyCap;
    int suggestionCap;

    std::string                inputLine;
    std::deque<ConsoleLine>    output;
    std::deque<std::string>    commandHistory;
    int                        historyCursor{-1}; // -1 == not browsing
    // Snapshot of `inputLine` taken at the moment the walk started.
    // Used as the filter needle for every step AND as the buffer
    // restored when Down walks past the newest match. Cleared whenever
    // the user types / backspaces.
    std::string                historyNeedle;
    bool                       historyWalkActive{false};

    // Tab-cycle autocomplete state. `cachedPrefix` is the input
    // snapshot at the moment cycling started; if `inputLine` no longer
    // starts with it (user kept typing), we rebuild the candidate list.
    std::vector<std::string>   completionCandidates;
    std::string                cachedPrefix;
    int                        completionIndex{-1};

    // Typing-time dropdown state (independent of the Tab-cycle above).
    std::vector<std::string>   suggestionList;
    int                        suggestionCursor{-1};

    // card-mpkd92tu — current scroll offset (lines from the bottom).
    int                        outputScrollOffset{0};

    const dof::loaders::ConfigLoader* attachedLoader{nullptr};
};

// --- pure helpers (free functions so they can be unit-tested) ---
//
// Build the prefix-matching candidate list from a sorted union of every
// config key plus the static commands ("all", "config:"). Returns lex-
// sorted, no duplicates.
std::vector<std::string> buildAutocompleteCandidates(const dof::loaders::ConfigLoader& loader,
                                                      const std::string& prefix);

// Same shape as `buildAutocompleteCandidates` but caps the result at
// `limit`. Exposed so `Console::refreshSuggestions` and tests share the
// exact same path. `limit <= 0` returns an empty vector.
std::vector<std::string> buildSuggestionList(const dof::loaders::ConfigLoader& loader,
                                              const std::string& prefix,
                                              int limit);

// T-CONSOLE-history-filter — pure walker step. Given the history list,
// the current walk cursor (`-1` for "not yet walking"), the needle
// (case-insensitive substring filter — empty matches everything), the
// current input line, and the walk direction (`isBackward == true` for
// Up, `false` for Down), return the index of the next eligible history
// entry. A return value of `-1` signals "off the end" — the caller
// should restore the un-walked prefix (Down past newest) or stick at
// the current cursor (Up past oldest, if no further match exists). The
// helper skips history entries that equal `currentInput` so Up never
// turns into a no-op replay of an already-shown line.
int stepHistoryWalk(const std::deque<std::string>& historyEntries,
                    int currentCursor,
                    const std::string& needle,
                    const std::string& currentInput,
                    bool isBackward);

// Format the response lines produced by a parsed ConsoleCommand against
// the given config. Pure: takes a loader reference but does not mutate
// unless `kind == SetKey`. Returns a list of (kind, text) lines.
std::vector<ConsoleLine> formatCommandResponse(const ConsoleCommand& cmd,
                                                 dof::loaders::ConfigLoader& loader);

}
