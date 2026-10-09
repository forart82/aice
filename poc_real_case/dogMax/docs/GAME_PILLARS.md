# Game Pillars

Updated: 2026-07-18

This file is the short product truth for dogmax. It does not replace
`GameDesign.md`; it tells future work what the game must become and what to
ignore when ideas multiply.

## One Sentence

dogmax is a dark-neon horde ARPG where the player survives overwhelming swarms
by building broken-but-readable weapon, dice, Dron, loot, and progression
synergies.

## Reference Mix

- **Vampire Survivors**: constant pressure, readable screen-filling swarms, fast
  run momentum.
- **Path of Exile**: item depth, scaling, build identity, long-term progression.
- **Balatro**: combinatorial surprise, simple parts creating strong synergies.
- **Dungeon Siege**: ARPG exploration feel, party/world ambition, loot journey.

The target is not a clone of any one reference. Each feature must earn its place
by strengthening dogmax's own loop.

## Pillars

1. **Readable swarm chaos**
   Thousands of enemies can exist at once, but danger, player position, and
   combat feedback must remain understandable.

2. **Build discovery over raw accumulation**
   Weapons, dice, Dron patterns, quality, luck, powder, and crafting should make
   the player ask "what if I combine these?" rather than only "which number is
   bigger?"

3. **Loot decisions with low friction**
   Loot can be deep, but picking up, comparing, slotting, powdering, and
   upgrading must be fast enough for a horde game.

4. **A dark-neon authored journey worth moving through**
   Routes, landmarks, combat spaces, and permanent consequences should make
   movement feel intentional rather than like an empty generated arena.

5. **Small verified slices**
   The project is too large for speculative rewrites. Each work session should
   improve one player-visible thing, verify it, commit it, and update these docs
   only when the product direction changed.

## Anti-Pillars

- Do not add a system only because a reference game has it.
- Do not add depth that the player cannot understand, control, or exploit.
- Do not create large kanbans or giant speculative plans as the main workflow.
- Do not treat archive files as current truth.
- Do not use "future flexibility" as a reason to add architecture now.

## Truth Layers

1. **Git commits and live source** define what is actually shipped.
2. **These direction docs** define the current product intent and workflow.
3. **`GameDesign.md`** holds the detailed design vocabulary and long-form spec.
4. **Archive material** is reference-only history and must be re-judged before
   anything is promoted back into live code or live docs.
