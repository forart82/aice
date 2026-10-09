/**
 * Ouroboros Ascension — FloorClearScreen (Floor Cleared Summary)
 *
 * Subclasses RunSummaryScreen for backward compatibility with existing tests and screen routing.
 */

import { RunSummaryScreen } from './RunSummaryScreen';
import { UiRoot } from '../UiRoot';

export class FloorClearScreen extends RunSummaryScreen {
  constructor(root: UiRoot) {
    super(root, 'modal-floor-clear', 'floor_clear');
  }
}
