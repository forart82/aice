<!-- AICE:START v0.9.50 -->
## AICE (v0.9.50)
- Gate: ONLY if `aice.config.json` has `"enabled": true` (code/config/md + passthrough/extensionless). Blocker: `aice disable`/`aice enable`.
### 2. Batch Read & Splice (No Shell Workarounds)
- ONLY `aice read`/`search`/`find` (`aice_read`) & `aice splice`/`aice write` (`aice_splice`); no shell writes or `sed`/`grep`/`cat`/`find`.
- Read: `aice read f1:sym f2:L1-L50`, quote `'f:/a|b/'` (no bash `exit 127`), `aice search <pat> [dir]`, `aice find -d 2`.
- Splice: `aice splice --stdin << 'EOF'` `=== f:sym ===`, `=== f:L1-L20 ===` (`--delete`, `=== f ===`), multi-line `<<<`/`===`/`>>>` (no 1L `<<< === >>>`).
- Briefs: `"Use AICE (aice read / aice splice) for all file exploration and edits."`
<!-- AICE:END -->
