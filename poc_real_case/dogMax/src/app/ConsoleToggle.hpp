#pragma once

// B-UX-8 — pure-logic caret toggle helper. Lifted out of
// `GameSession::processWindowEvents` so the toggle can be unit-tested
// without standing up an SFML window. The keyboard path threads the
// codepoint from `sf::Event::TextEntered` straight through.

namespace dof::app {

struct CaretToggleOutcome {
    bool handled{false};      // True iff the codepoint was the caret toggle.
    bool nowVisible{false};   // The post-toggle console visibility.
};

// Returns `handled=true` when the codepoint is the caret (`^`,
// codepoint 0x5E); the caller flips the console visibility + focus
// flags accordingly. Returning the flipped state in the same call
// keeps the toggle deterministic regardless of focus state, which
// makes pressing `^` while the console is visible close it again
// (B-UX-8). For any other codepoint the helper returns
// `handled=false` and the caller continues to feed the input line.
CaretToggleOutcome toggleConsoleOnCaret(unsigned int unicode, bool wasVisible);

}
