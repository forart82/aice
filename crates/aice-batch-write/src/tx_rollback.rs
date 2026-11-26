use std::fs::{self, OpenOptions, Permissions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static RB_SEQ: AtomicU64 = AtomicU64::new(1);

pub(crate) struct RollbackEntry {
    pub target: PathBuf,
    pub orig_bytes: Option<Vec<u8>>,
    pub orig_perms: Option<Permissions>,
}

fn try_atomic_restore(
    target: &Path,
    bytes: &[u8],
    orig_perms: &Option<Permissions>,
) -> std::io::Result<()> {
    let parent = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let seq = RB_SEQ.fetch_add(1, Ordering::Relaxed);
    let rb_tmp = parent.join(format!(".aice.tmp.rb.{}.{seq}", std::process::id()));
    let res = (|| -> std::io::Result<()> {
        let mut f = OpenOptions::new().write(true).create_new(true).open(&rb_tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        if let Some(perms) = orig_perms {
            fs::set_permissions(&rb_tmp, perms.clone())?;
        }
        fs::rename(&rb_tmp, target)
    })();
    if res.is_err() {
        let _ = fs::remove_file(&rb_tmp);
    }
    res
}

fn restore_backup_file(target: &Path, bytes: &[u8], orig_perms: Option<Permissions>) {
    if try_atomic_restore(target, bytes, &orig_perms).is_ok() {
        return;
    }
    #[cfg(unix)]
    if let Ok(meta) = fs::metadata(target) {
        use std::os::unix::fs::PermissionsExt;
        let mut writable = meta.permissions();
        if writable.readonly() {
            writable.set_mode(writable.mode() | 0o200);
            let _ = fs::set_permissions(target, writable);
        }
    }
    let _ = fs::write(target, bytes);
    if let Some(perms) = orig_perms {
        let _ = fs::set_permissions(target, perms);
    }
}

pub(crate) fn rollback_disk(
    backups: Vec<RollbackEntry>,
    created_dirs: Vec<PathBuf>,
    temps: Vec<PathBuf>,
) {
    for t in temps {
        let _ = fs::remove_file(t);
    }
    for entry in backups.into_iter().rev() {
        match entry.orig_bytes {
            Some(bytes) => restore_backup_file(&entry.target, &bytes, entry.orig_perms),
            None => {
                let _ = fs::remove_file(&entry.target);
            }
        }
    }
    for dir in created_dirs.into_iter().rev() {
        let _ = fs::remove_dir(dir);
    }
}
