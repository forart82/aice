use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Condvar, Mutex, MutexGuard};

pub(crate) fn lock_recover<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub(crate) struct DirTask {
    pub dir: PathBuf,
    pub canon_dir: PathBuf,
    pub canon_verified: bool,
    pub depth: usize,
    pub root_in_node_modules: bool,
}

pub(crate) enum WalkTask {
    Dir(DirTask),
    Files { depth: usize, paths: Vec<PathBuf> },
}

pub(crate) struct WorkState {
    pub queue: VecDeque<WalkTask>,
    pub active: usize,
    pub waiters: usize,
    pub aborted: bool,
}

pub(crate) struct ActiveTaskGuard<'a> {
    state: &'a Mutex<WorkState>,
    cvar: &'a Condvar,
    completed: bool,
}

fn push_and_notify(guard: &mut WorkState, cvar: &Condvar, pending: &mut Vec<WalkTask>) {
    let pushed = pending.len();
    if pushed == 0 {
        return;
    }
    guard.queue.extend(pending.drain(..));
    if guard.waiters > 0 {
        if pushed == 1 {
            cvar.notify_one();
        } else {
            cvar.notify_all();
        }
    }
}

impl<'a> ActiveTaskGuard<'a> {
    pub(crate) fn new(state: &'a Mutex<WorkState>, cvar: &'a Condvar) -> Self {
        Self { state, cvar, completed: false }
    }

    pub(crate) fn publish_tasks(&self, pending: &mut Vec<WalkTask>) -> bool {
        let mut guard = lock_recover(self.state);
        if guard.aborted {
            pending.clear();
            return false;
        }
        push_and_notify(&mut guard, self.cvar, pending);
        true
    }

    pub(crate) fn complete(mut self, pending: &mut Vec<WalkTask>) {
        let mut guard = lock_recover(self.state);
        guard.active = guard.active.saturating_sub(1);
        if !guard.aborted && !pending.is_empty() {
            push_and_notify(&mut guard, self.cvar, pending);
        } else if (guard.aborted || (guard.queue.is_empty() && guard.active == 0))
            && guard.waiters > 0
        {
            self.cvar.notify_all();
        }
        self.completed = true;
    }
}

impl Drop for ActiveTaskGuard<'_> {
    fn drop(&mut self) {
        if !self.completed {
            let mut guard = lock_recover(self.state);
            guard.active = guard.active.saturating_sub(1);
            guard.aborted = true;
            self.cvar.notify_all();
        }
    }
}

pub(crate) fn next_task(state: &Mutex<WorkState>, cvar: &Condvar) -> Option<WalkTask> {
    let mut guard = lock_recover(state);
    loop {
        if guard.aborted {
            cvar.notify_all();
            return None;
        }
        if let Some(t) = guard.queue.pop_front() {
            guard.active += 1;
            return Some(t);
        }
        if guard.active == 0 {
            cvar.notify_all();
            return None;
        }
        guard.waiters += 1;
        guard = cvar.wait(guard).unwrap_or_else(|e| e.into_inner());
        guard.waiters = guard.waiters.saturating_sub(1);
    }
}

pub(crate) const FILE_BATCH_SPLIT_THRESHOLD: usize = 24;
pub(crate) const FILE_BATCH_SIZE: usize = 16;

pub(crate) fn split_excess_files(
    depth: usize,
    dir_files: &mut Vec<PathBuf>,
    pending: &mut Vec<WalkTask>,
) {
    if dir_files.len() <= FILE_BATCH_SPLIT_THRESHOLD {
        return;
    }
    let mut rest = dir_files.split_off(FILE_BATCH_SIZE);
    while rest.len() > FILE_BATCH_SPLIT_THRESHOLD {
        let tail = rest.split_off(FILE_BATCH_SIZE);
        pending.push(WalkTask::Files { depth, paths: rest });
        rest = tail;
    }
    if !rest.is_empty() {
        pending.push(WalkTask::Files { depth, paths: rest });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_panic_drops_active_guard_and_unblocks_peers() {
        let state = Mutex::new(WorkState {
            queue: VecDeque::from([WalkTask::Dir(DirTask {
                dir: PathBuf::from("."),
                canon_dir: PathBuf::from("."),
                canon_verified: true,
                depth: 1,
                root_in_node_modules: false,
            })]),
            active: 0,
            waiters: 0,
            aborted: false,
        });
        let cvar = Condvar::new();
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            std::thread::scope(|scope| {
                for _ in 0..4 {
                    scope.spawn(|| {
                        if let Some(_task) = next_task(&state, &cvar) {
                            let _guard = ActiveTaskGuard::new(&state, &cvar);
                            std::thread::sleep(std::time::Duration::from_millis(10));
                            panic!("simulated worker panic");
                        }
                    });
                }
            });
        }));
        assert!(res.is_err(), "panic must propagate without deadlock");
        let guard = state.lock().unwrap_or_else(|e| e.into_inner());
        assert_eq!(guard.active, 0);
        assert!(guard.aborted);
        drop(guard);
        assert!(next_task(&state, &cvar).is_none());
    }
}
