/**
 * Ouroboros Ascension — The Codex Modal Screen (CodexModalScreen.ts)
 *
 * Re-exports the authoritative Codex and Field Guide implementation (HelpScreen)
 * ensuring 100% architectural naming parity, multi-screen contracts, and test harness interoperability.
 */

import { HelpScreen, CodexCategory, ICodexEntry, CodexLevel, CodexViewMode, INavStackEntry } from './HelpScreen';

export { HelpScreen as CodexModalScreen, HelpScreen };
export type { CodexCategory, ICodexEntry, CodexLevel, CodexViewMode, INavStackEntry };
