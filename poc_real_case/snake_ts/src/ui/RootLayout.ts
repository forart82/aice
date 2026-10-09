/**
 * Ouroboros Ascension — Responsive Root Layout & Screen Host (RootLayout.ts)
 *
 * Provides a standardized RootLayout container class and alias for UiRoot,
 * coordinating responsive layout subscriptions, HUD views, modal navigation,
 * and screens registration including StatsModalScreen.
 */

import { UiRoot, IScreen } from './UiRoot.js';
import { StatsModalScreen } from './screens/StatsModalScreen.js';

export class RootLayout extends UiRoot {
  /**
   * Initializes RootLayout and registers default core screens if not already present.
   * @param container DOM element hosting UI layer
   * @param engine Optional reference to active GameEngine
   */
  constructor(container: HTMLElement, engine?: any) {
    super(container, engine);
  }

  /**
   * Factory method creating and assigning the global singleton instance.
   */
  public static override init(container: HTMLElement, engine?: any): RootLayout {
    const root = new RootLayout(container, engine);
    // Assign instance to UiRoot singleton
    (UiRoot as any)._instance = root;
    return root;
  }

  /**
   * Helper to ensure StatsModalScreen is registered with this layout.
   */
  public registerStatsModalScreen(): StatsModalScreen {
    let screen = this.getScreen<StatsModalScreen>('modal-stats');
    if (!screen) {
      screen = new StatsModalScreen(this);
      this.registerScreen(screen);
    }
    return screen;
  }
}

export type { IScreen };
export default RootLayout;
