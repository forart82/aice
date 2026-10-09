# RTK - Token-Efficient Command Output

RTK 0.43 or newer is available at `~/.local/bin/rtk`. Use it selectively when
its compact output preserves the evidence required by the current task.

Use RTK for high-volume, read-only output:

- Search: `rtk rg ...` or `rtk grep ...`.
- Git inspection: `rtk git status`, `rtk git diff`, `rtk git log`, and
  `rtk git show`.
- Large known-file reads: `rtk read <path>` when a bounded `sed` range is not
  more appropriate.
- Large logs or generic noisy commands: `rtk log`, `rtk err`, or `rtk summary`
  only when the filtered form still proves the required result.

Do not use RTK where exact raw output is part of verification:

- Europe/Paris timestamps.
- YAML parsing, image metadata, hashes, or exact numeric assertions.
- `./bt`, `./bt dev`, `./runGame`, headless/offscreen smokes, or commands whose
  success artifact and complete diagnostics must be reported.
- Short output that RTK cannot materially reduce.

If compressed output hides a needed fact, rerun only the relevant command or
path without RTK. Use `rtk gain` to measure savings; never optimize token count
at the cost of correctness or required verification evidence.
