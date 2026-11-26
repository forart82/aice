use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashSet};

use crate::dep_graph::DepNodeTier;

pub(crate) fn condense_and_topo_sort(
    n: usize,
    adj: &[Vec<usize>],
    tiers: &[DepNodeTier],
    labels: &[String],
) -> Vec<usize> {
    if n == 0 {
        return Vec::new();
    }
    let sccs = iterative_tarjan(n, adj);
    let mut scc_of = vec![0usize; n];
    let mut scc_members: Vec<Vec<usize>> = Vec::with_capacity(sccs.len());
    for (sid, mut members) in sccs.into_iter().enumerate() {
        members.sort_by(|&a, &b| (tiers[a], a, &labels[a]).cmp(&(tiers[b], b, &labels[b])));
        for &u in &members {
            scc_of[u] = sid;
        }
        scc_members.push(members);
    }
    let num_sccs = scc_members.len();
    let mut dag_adj: Vec<Vec<usize>> = vec![Vec::new(); num_sccs];
    let mut indeg = vec![0usize; num_sccs];
    let mut seen_dag: HashSet<(usize, usize)> = HashSet::new();
    for (u, nbrs) in adj.iter().enumerate() {
        let su = scc_of[u];
        for &v in nbrs {
            let sv = scc_of[v];
            if su != sv && seen_dag.insert((su, sv)) {
                dag_adj[su].push(sv);
                indeg[sv] += 1;
            }
        }
    }
    let mut heap: BinaryHeap<Reverse<(DepNodeTier, usize, String, usize)>> = BinaryHeap::new();
    for (sid, &deg) in indeg.iter().enumerate() {
        if deg == 0 {
            let lead = scc_members[sid][0];
            heap.push(Reverse((tiers[lead], lead, labels[lead].clone(), sid)));
        }
    }
    let mut out = Vec::with_capacity(n);
    while let Some(Reverse((_, _, _, sid))) = heap.pop() {
        out.extend_from_slice(&scc_members[sid]);
        for &nxt in &dag_adj[sid] {
            indeg[nxt] -= 1;
            if indeg[nxt] == 0 {
                let lead = scc_members[nxt][0];
                heap.push(Reverse((tiers[lead], lead, labels[lead].clone(), nxt)));
            }
        }
    }
    out
}

fn iterative_tarjan(n: usize, adj: &[Vec<usize>]) -> Vec<Vec<usize>> {
    struct Frame {
        u: usize,
        edge_idx: usize,
    }
    let mut index_counter = 0usize;
    let mut indices = vec![usize::MAX; n];
    let mut lowlink = vec![0usize; n];
    let mut on_stack = vec![false; n];
    let mut tarjan_stack = Vec::new();
    let mut call_stack = Vec::new();
    let mut sccs = Vec::new();

    for start in 0..n {
        if indices[start] != usize::MAX {
            continue;
        }
        indices[start] = index_counter;
        lowlink[start] = index_counter;
        index_counter += 1;
        on_stack[start] = true;
        tarjan_stack.push(start);
        call_stack.push(Frame { u: start, edge_idx: 0 });

        while let Some(top) = call_stack.last_mut() {
            let u = top.u;
            if top.edge_idx < adj[u].len() {
                let v = adj[u][top.edge_idx];
                top.edge_idx += 1;
                if indices[v] == usize::MAX {
                    indices[v] = index_counter;
                    lowlink[v] = index_counter;
                    index_counter += 1;
                    on_stack[v] = true;
                    tarjan_stack.push(v);
                    call_stack.push(Frame { u: v, edge_idx: 0 });
                } else if on_stack[v] {
                    lowlink[u] = lowlink[u].min(indices[v]);
                }
            } else {
                call_stack.pop();
                if let Some(parent) = call_stack.last() {
                    lowlink[parent.u] = lowlink[parent.u].min(lowlink[u]);
                }
                if lowlink[u] == indices[u] {
                    let mut comp = Vec::new();
                    while let Some(w) = tarjan_stack.pop() {
                        on_stack[w] = false;
                        comp.push(w);
                        if w == u {
                            break;
                        }
                    }
                    sccs.push(comp);
                }
            }
        }
    }
    sccs
}
