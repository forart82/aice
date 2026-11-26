use crate::r6::sql_lex::LexOpts;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum MigDialect {
    Postgres,
    MySql,
    Sqlite,
    TSql,
    Ansi,
}

pub(crate) fn mig_lex_opts(d: MigDialect) -> LexOpts {
    LexOpts {
        allow_brackets: matches!(d, MigDialect::TSql | MigDialect::Sqlite | MigDialect::Ansi),
        allow_backtick: matches!(d, MigDialect::MySql | MigDialect::Sqlite | MigDialect::Ansi),
        allow_dollar: matches!(d, MigDialect::Postgres | MigDialect::Ansi),
        allow_hash_comment: matches!(d, MigDialect::MySql),
        nested_block_comments: matches!(d, MigDialect::Postgres | MigDialect::TSql),
        backslash_escape: matches!(d, MigDialect::MySql),
        allow_at_var: matches!(d, MigDialect::MySql | MigDialect::TSql),
    }
}

pub(crate) fn detect_mig_dialect(sub: &str) -> MigDialect {
    let up = sub.to_ascii_uppercase();
    if has_delimiter_directive(&up) || has_mysql_table_kw(&up) {
        return MigDialect::MySql;
    }
    if has_pg_dollar_tag(sub) || up.contains("PLPGSQL") || up.contains("PL/PGSQL") {
        return MigDialect::Postgres;
    }
    if has_tsql_go(sub) {
        return MigDialect::TSql;
    }
    if up.contains("PRAGMA") || up.contains("WITHOUT ROWID") || up.contains("AUTOINCREMENT") || has_paren_strict(&up) {
        return MigDialect::Sqlite;
    }
    if has_unquoted_char(sub, b'`') {
        return MigDialect::MySql;
    }
    if has_unquoted_char(sub, b'[') {
        return MigDialect::TSql;
    }
    MigDialect::Ansi
}

fn has_paren_strict(up: &str) -> bool {
    let b = up.as_bytes();
    let mut i = 0usize;
    while i < b.len() {
        if b[i] == b')' {
            let mut j = i + 1;
            while j < b.len() && b[j].is_ascii_whitespace() { j += 1; }
            if up.get(j..j + 6) == Some("STRICT")
                && b.get(j + 6).is_none_or(|&c| !c.is_ascii_alphanumeric() && c != b'_')
            {
                return true;
            }
        }
        i += 1;
    }
    false
}

fn has_delimiter_directive(up: &str) -> bool {
    up.lines().any(|l| l.trim_start().starts_with("DELIMITER "))
}

fn has_mysql_table_kw(up: &str) -> bool {
    up.contains("AUTO_INCREMENT") || up.contains("ENGINE=") || up.contains("ENGINE =")
}

fn has_tsql_go(sub: &str) -> bool {
    sub.lines().any(|l| {
        let s = l.split("--").next().unwrap_or("").trim();
        s.eq_ignore_ascii_case("GO")
            || (s.get(..2).is_some_and(|h| h.eq_ignore_ascii_case("GO"))
                && s.get(2..).is_some_and(|rest| {
                    rest.starts_with(char::is_whitespace) && rest.trim().parse::<usize>().is_ok()
                }))
    })
}

fn has_pg_dollar_tag(src: &str) -> bool {
    let b = src.as_bytes();
    let (mut i, mut in_sq, mut in_blk) = (0usize, false, false);
    while i < b.len() {
        if in_blk {
            if b[i] == b'*' && i + 1 < b.len() && b[i + 1] == b'/' { in_blk = false; i += 2; }
            else { i += 1; }
            continue;
        }
        if in_sq {
            if b[i] == b'\'' { if i + 1 < b.len() && b[i + 1] == b'\'' { i += 2; } else { in_sq = false; i += 1; } }
            else { i += 1; }
            continue;
        }
        if b[i] == b'-' && i + 1 < b.len() && b[i + 1] == b'-' {
            while i < b.len() && b[i] != b'\n' { i += 1; }
            continue;
        }
        if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'*' { in_blk = true; i += 2; continue; }
        if b[i] == b'\'' { in_sq = true; i += 1; continue; }
        if b[i] == b'$' {
            let mut j = i + 1;
            if j < b.len() && b[j] == b'$' { return true; }
            if j < b.len() && (b[j].is_ascii_alphabetic() || b[j] == b'_') {
                j += 1;
                while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_') { j += 1; }
                if j < b.len() && b[j] == b'$' { return true; }
            }
        }
        i += 1;
    }
    false
}

fn has_unquoted_char(src: &str, target: u8) -> bool {
    let b = src.as_bytes();
    let (mut i, mut in_sq, mut in_blk) = (0usize, false, false);
    while i < b.len() {
        if in_blk {
            if b[i] == b'*' && i + 1 < b.len() && b[i + 1] == b'/' { in_blk = false; i += 2; }
            else { i += 1; }
            continue;
        }
        if in_sq {
            if b[i] == b'\'' { if i + 1 < b.len() && b[i + 1] == b'\'' { i += 2; } else { in_sq = false; i += 1; } }
            else { i += 1; }
            continue;
        }
        if b[i] == b'-' && i + 1 < b.len() && b[i + 1] == b'-' {
            while i < b.len() && b[i] != b'\n' { i += 1; }
            continue;
        }
        if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'*' { in_blk = true; i += 2; continue; }
        if b[i] == b'\'' { in_sq = true; i += 1; continue; }
        if b[i] == target { return true; }
        i += 1;
    }
    false
}
