use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Condvar, Mutex};

use crate::ignore_rules::{EntryCheck, IgnorePolicy};
use crate::walker::{FindWalkOpts, WalkedFile};
use crate::walker_probe::{STREAM_BUF_LEN, directory_has_visible_files, inspect_file};
pub(crate) use crate::walker_queue::DirTask;
use crate::walker_queue::{
    ActiveTaskGuard, WalkTask, WorkState, lock_recover, next_task, split_excess_files,
};
use crate::walker_seed::is_canon_contained;

pub(crate) struct WalkContext<'a> {
    pub opts: &'a FindWalkOpts,
    pub ignore: &'a IgnorePolicy,
    pub effective_max_depth: Option<usize>,
    pub root_canon: Option<PathBuf>,
    pub allowed_canons: Vec<PathBuf>,
    pub has_overlapping_roots: bool,
    pub needs_canon_paths: bool,
}

pub(crate) fn run_parallel_walk(
    mut initial_tasks: Vec<DirTask>,
    ctx: &WalkContext<'_>,
) -> (Vec<WalkedFile>, Vec<PathBuf>, Vec<PathBuf>) {
    if initial_tasks.is_empty() {
        return (Vec::new(), Vec::new(), Vec::new());
    }
    let visited_dirs =
        ctx.has_overlapping_roots.then(|| Mutex::new(HashMap::<PathBuf, usize>::new()));
    let max_workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(1, 4);
    let mut initial_queue = VecDeque::new();
    let mut prescan_boundaries = Vec::new();
    let mut prescan_entered = Vec::new();

    if !ctx.has_overlapping_roots
        && initial_tasks.len() == 1
        && ctx.effective_max_depth.is_none_or(|d| d > 1)
    {
        let root_task = initial_tasks.pop().expect("len == 1");
        prescan_root(
            root_task,
            ctx,
            &mut initial_queue,
            &mut prescan_boundaries,
            &mut prescan_entered,
        );
        if initial_queue.is_empty() {
            return (Vec::new(), prescan_boundaries, prescan_entered);
        }
    } else {
        initial_queue.extend(initial_tasks.into_iter().map(WalkTask::Dir));
    }

    let has_dir = initial_queue.iter().any(|t| matches!(t, WalkTask::Dir(_)));
    let num_workers = if ctx.effective_max_depth == Some(1) && initial_queue.len() <= 1 {
        1
    } else if has_dir && initial_queue.len() == 1 {
        max_workers
    } else {
        initial_queue.len().clamp(1, max_workers)
    };

    let state = Mutex::new(WorkState { queue: initial_queue, active: 0, waiters: 0, aborted: false });
    let cvar = Condvar::new();
    let collected_files = Mutex::new(Vec::<WalkedFile>::new());
    let collected_boundaries = Mutex::new(prescan_boundaries);
    let collected_entered = Mutex::new(prescan_entered);

    std::thread::scope(|scope| {
        for _ in 1..num_workers {
            scope.spawn(|| {
                run_worker(
                    &state,
                    &cvar,
                    ctx,
                    visited_dirs.as_ref(),
                    &collected_files,
                    &collected_boundaries,
                    &collected_entered,
                );
            });
        }
        run_worker(
            &state,
            &cvar,
            ctx,
            visited_dirs.as_ref(),
            &collected_files,
            &collected_boundaries,
            &collected_entered,
        );
    });

    (
        collected_files.into_inner().unwrap_or_else(|e| e.into_inner()),
        collected_boundaries.into_inner().unwrap_or_else(|e| e.into_inner()),
        collected_entered.into_inner().unwrap_or_else(|e| e.into_inner()),
    )
}

fn prescan_root(
    mut cur: DirTask,
    ctx: &WalkContext<'_>,
    initial_queue: &mut VecDeque<WalkTask>,
    boundaries: &mut Vec<PathBuf>,
    entered: &mut Vec<PathBuf>,
) {
    let mut dir_files = Vec::new();
    let mut pending = Vec::new();
    for step in 0..2 {
        scan_dir_entries(&cur, ctx, None, &mut dir_files, &mut pending, boundaries, entered);
        if step == 0
            && dir_files.is_empty()
            && pending.len() == 1
            && let Some(WalkTask::Dir(next)) = pending.pop()
        {
            cur = next;
            continue;
        }
        break;
    }
    let root_depth = cur.depth;
    split_excess_files(root_depth, &mut dir_files, &mut pending);
    initial_queue.extend(pending);
    if !dir_files.is_empty() {
        initial_queue.push_front(WalkTask::Files {
            depth: root_depth,
            paths: dir_files,
        });
    }
}

fn run_worker(
    state: &Mutex<WorkState>,
    cvar: &Condvar,
    ctx: &WalkContext<'_>,
    visited_dirs: Option<&Mutex<HashMap<PathBuf, usize>>>,
    collected_files: &Mutex<Vec<WalkedFile>>,
    collected_boundaries: &Mutex<Vec<PathBuf>>,
    collected_entered: &Mutex<Vec<PathBuf>>,
) {
    let mut local_files = Vec::new();
    let mut local_boundaries = Vec::new();
    let mut local_entered = Vec::new();
    let mut pending = Vec::with_capacity(16);
    let mut dir_files = Vec::with_capacity(32);
    let mut scratch = vec![0u8; STREAM_BUF_LEN];

    while let Some(task) = next_task(state, cvar) {
        let guard = ActiveTaskGuard::new(state, cvar);
        match task {
            WalkTask::Files { depth, paths } => {
                for path in paths {
                    if let Some(wf) = inspect_file(path, depth, ctx.opts, &mut scratch) {
                        local_files.push(wf);
                    }
                }
                guard.complete(&mut pending);
            }
            WalkTask::Dir(mut dir_task) => {
                loop {
                    dir_files.clear();
                    scan_dir_entries(
                        &dir_task,
                        ctx,
                        visited_dirs,
                        &mut dir_files,
                        &mut pending,
                        &mut local_boundaries,
                        &mut local_entered,
                    );
                    split_excess_files(dir_task.depth, &mut dir_files, &mut pending);
                    if !dir_files.is_empty() {
                        if !pending.is_empty() && !guard.publish_tasks(&mut pending) {
                            dir_files.clear();
                            break;
                        }
                        for path in dir_files.drain(..) {
                            if let Some(wf) =
                                inspect_file(path, dir_task.depth, ctx.opts, &mut scratch)
                            {
                                local_files.push(wf);
                            }
                        }
                        break;
                    }
                    let Some(WalkTask::Dir(next)) = pending.pop() else {
                        break;
                    };
                    if !pending.is_empty() && !guard.publish_tasks(&mut pending) {
                        break;
                    }
                    dir_task = next;
                }
                guard.complete(&mut pending);
            }
        }
    }

    if !local_files.is_empty() {
        lock_recover(collected_files).extend(local_files);
    }
    if !local_boundaries.is_empty() {
        lock_recover(collected_boundaries).extend(local_boundaries);
    }
    if !local_entered.is_empty() {
        lock_recover(collected_entered).extend(local_entered);
    }
}

fn scan_dir_entries(
    task: &DirTask,
    ctx: &WalkContext<'_>,
    visited_dirs: Option<&Mutex<HashMap<PathBuf, usize>>>,
    dir_files: &mut Vec<PathBuf>,
    pending: &mut Vec<WalkTask>,
    local_boundaries: &mut Vec<PathBuf>,
    local_entered: &mut Vec<PathBuf>,
) {
    if !task.canon_verified && !is_canon_contained(&task.canon_dir, ctx) {
        return;
    }
    if let Some(visited) = visited_dirs {
        let mut map = lock_recover(visited);
        match map.get_mut(&task.canon_dir) {
            Some(best) if *best <= task.depth => return,
            Some(best) => *best = task.depth,
            None => { map.insert(task.canon_dir.clone(), task.depth); }
        }
    }
    let Ok(entries) = std::fs::read_dir(&task.dir) else {
        return;
    };
    if ctx.effective_max_depth.is_some() {
        local_entered.push(task.dir.clone());
        if ctx.needs_canon_paths
            && !task.canon_dir.as_os_str().is_empty()
            && task.canon_dir != task.dir
        {
            local_entered.push(task.canon_dir.clone());
        }
    }
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == "." || name_str == ".." || name_str == ".git" {
            continue;
        }
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if ft.is_dir() {
            let path = match ctx.ignore.fast_check_dir(&name_str, task.root_in_node_modules) {
                EntryCheck::Skip => continue,
                EntryCheck::Allow => entry.path(),
                EntryCheck::NeedPath => {
                    let p = entry.path();
                    if ctx.ignore.should_skip_dir(&name_str, &p, task.root_in_node_modules) {
                        continue;
                    }
                    p
                }
            };
            let child_in_nm = task.root_in_node_modules || name_str == "node_modules";
            let child_canon = if ctx.needs_canon_paths { task.canon_dir.join(&name) } else { PathBuf::new() };
            if ctx.effective_max_depth.is_some_and(|max_d| task.depth >= max_d) {
                if directory_has_visible_files(&path, child_canon, child_in_nm, ctx) {
                    local_boundaries.push(path);
                }
            } else {
                pending.push(WalkTask::Dir(DirTask {
                    dir: path, canon_dir: child_canon, canon_verified: true,
                    depth: task.depth + 1, root_in_node_modules: child_in_nm,
                }));
            }
        } else if ft.is_file() {
            match ctx.ignore.fast_check_file(&name_str) {
                EntryCheck::Skip => continue,
                EntryCheck::Allow => dir_files.push(entry.path()),
                EntryCheck::NeedPath => {
                    let p = entry.path();
                    if !ctx.ignore.should_skip_file(&name_str, &p) {
                        dir_files.push(p);
                    }
                }
            }
        }
    }
}
