use std::path::Path;

use crate::cmd_admin::run_help;

pub fn emit_help(topic: Option<&str>, cwd: &Path) -> i32 {
    run_help(topic, cwd)
}
