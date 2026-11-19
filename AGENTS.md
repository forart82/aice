<!-- AICE:START v0.9.52 -->
## AICE (v0.9.52)
- Gate: ONLY if `aice.config.json` has `"enabled": true`; blocker: `aice disable` / `aice enable`.
### Batch Read & Splice
- ONLY aice read/search/find (aice_read) & aice splice/aice write (aice_splice); no shell writes or `sed`/`grep`/`cat`/`find`.
- Read: `aice read f1:sym f2:L1-L50`, quote 'f:/a|b/', `aice search <pat> [dir]`, `aice find -d 2`.
- No paging: NEVER walk `:L1-L150` -> `:L151-L300` across turns; batch `f:sym1 f:sym2` (or multi-file) in 1 `aice read` or `aice search <pat> f`.
- Splice: `aice splice --stdin << 'EOF'` (=== f:sym ===, === f:L1-L20 ===, --delete, === f ===), multi-line `<<< === >>>` (no 1L).
- Briefs: "Use AICE (aice read / aice splice) for all file exploration and edits."
<!-- AICE:END -->
