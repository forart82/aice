/**
 * Ouroboros Ascension — GameOverScreen (Defeat Summary)
 *
 * Subclasses RunSummaryScreen for backward compatibility with existing tests and screen routing.
 */

import { RunSummaryScreen } from './RunSummaryScreen';
import { UiRoot } from '../UiRoot';

export class GameOverScreen extends RunSummaryScreen {
  constructor(root: UiRoot) {
    super(root, 'modal-game-over', 'defeat');
  }
}
