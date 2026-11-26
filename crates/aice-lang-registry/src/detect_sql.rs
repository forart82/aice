use crate::detect_heuristics::{has_mysql_delimiter, has_word, is_ident_byte, strip_comments_and_strings};
use crate::lang_id::LanguageId;
pub(crate) fn detect_sql_dialect(file_name: &str, sample: &str) -> LanguageId {
    if is_flyway_name(file_name) || has_migration_comment(sample) {
        return LanguageId::DbMigration;
    }
    let base_stripped = strip_comments_and_strings(sample, b"--", false, false);
    let base_upper = base_stripped.to_ascii_uppercase();
    if has_mysql_delimiter(&base_upper) {
        return LanguageId::MySql;
    }
    let (stripped, has_dollar_quote) = strip_dollar_quotes(&base_stripped);
    if has_dollar_quote {
        return LanguageId::PostgreSql;
    }
    let upper = stripped.to_ascii_uppercase();
    if upper.contains("ENGINE=")
        || upper.contains("ENGINE =")
        || upper.contains("ON DUPLICATE KEY UPDATE")
        || has_word(&upper, "AUTO_INCREMENT")
    {
        return LanguageId::MySql;
    }
    if upper.lines().any(is_tsql_go_line)
        || upper.contains("DECLARE @")
        || ((upper.contains("CREATE PROC ") || upper.contains("CREATE PROCEDURE "))
            && upper.contains('@'))
        || upper.contains("BEGIN TRY")
        || upper.contains("BEGIN CATCH")
        || upper.contains("[DBO].")
        || upper.contains("SET NOCOUNT ON")
        || has_word(&upper, "NVARCHAR")
    {
        return LanguageId::TSql;
    }
    if stripped.contains("$$")
        || has_dollar_tag(&stripped)
        || upper.contains("PL/PGSQL")
        || upper.contains("PLPGSQL")
        || upper.contains("RETURNS TRIGGER")
        || (has_word(&upper, "DECLARE") && has_word(&upper, "EXCEPTION"))
        || upper.contains("::TEXT")
        || upper.contains("::JSONB")
        || has_word(&upper, "BIGSERIAL")
        || has_word(&upper, "TIMESTAMPTZ")
        || upper.contains("CREATE EXTENSION")
    {
        return LanguageId::PostgreSql;
    }
    if has_word(&upper, "PRAGMA")
        || upper.contains("WITHOUT ROWID")
        || has_sqlite_strict(&upper)
        || has_word(&upper, "AUTOINCREMENT")
    {
        return LanguageId::Sqlite;
    }
    LanguageId::AnsiSql
}

fn is_flyway_name(file_name: &str) -> bool {
    if file_name.starts_with("r__") {
        return true;
    }
    let Some(rest) = file_name
        .strip_prefix('v')
        .or_else(|| file_name.strip_prefix('u'))
    else {
        return false;
    };
    let digits = rest.bytes().take_while(|b| b.is_ascii_digit()).count();
    digits > 0 && rest[digits..].starts_with("__")
}

fn has_migration_comment(sample: &str) -> bool {
    let b = sample.as_bytes();
    let mut i = 0;
    let mut at_line_start = true;
    while i < b.len() {
        if b[i] == b'\n' {
            at_line_start = true;
            i += 1;
        } else if matches!(b[i], b' ' | b'\t' | b'\r') {
            i += 1;
        } else if i + 1 < b.len() && b[i] == b'/' && b[i + 1] == b'*' {
            at_line_start = false;
            i += 2;
            while i < b.len() {
                if i + 1 < b.len() && b[i] == b'*' && b[i + 1] == b'/' {
                    i += 2;
                    break;
                }
                i += 1;
            }
        } else if b[i] == b'\'' {
            at_line_start = false;
            i += 1;
            while i < b.len() {
                if b[i] == b'\'' {
                    i += 1;
                    if i < b.len() && b[i] == b'\'' {
                        i += 1;
                        continue;
                    }
                    break;
                }
                i += 1;
            }
        } else if let Some(tag_len) = match_dollar_tag(&b[i..]) {
            at_line_start = false;
            if let Some(close_rel) = find_subslice(&b[i + tag_len..], &b[i..i + tag_len]) {
                i += tag_len + close_rel + tag_len;
            } else {
                break;
            }
        } else if i + 1 < b.len() && b[i] == b'-' && b[i + 1] == b'-' {
            let start = i;
            while i < b.len() && b[i] != b'\n' && b[i] != b'\r' {
                i += 1;
            }
            if at_line_start {
                let cmt = sample[start..i].to_ascii_uppercase();
                if cmt.starts_with("-- +GOOSE")
                    || cmt.starts_with("-- MIGRATE:UP")
                    || cmt.starts_with("-- MIGRATE:DOWN")
                    || cmt.starts_with("-- LIQUIBASE FORMATTED SQL")
                {
                    return true;
                }
            }
            at_line_start = false;
        } else {
            at_line_start = false;
            i += 1;
        }
    }
    false
}

fn is_tsql_go_line(line: &str) -> bool {
    let t = line.trim();
    if t == "GO" {
        return true;
    }
    t.strip_prefix("GO").is_some_and(|rest| {
        t.as_bytes().get(2).is_some_and(|b| b.is_ascii_whitespace())
            && !rest.trim_start().is_empty()
            && rest.trim_start().bytes().all(|b| b.is_ascii_digit())
    })
}

fn has_sqlite_strict(upper: &str) -> bool {
    let hb = upper.as_bytes();
    let mut offset = 0;
    while let Some(pos) = upper[offset..].find("STRICT") {
        let start = offset + pos;
        let end = start + 6;
        offset = start + 1;
        if (start > 0 && is_ident_byte(hb[start - 1]))
            || (end < hb.len() && is_ident_byte(hb[end]))
        {
            continue;
        }
        let after = upper[end..].trim_start();
        let after_ok = after.is_empty()
            || after.starts_with(';')
            || after.strip_prefix(',').is_some_and(|r| {
                let r = r.trim_start();
                r.strip_prefix("WITHOUT").is_some_and(|w| {
                    w.starts_with(char::is_whitespace)
                        && w.trim_start().strip_prefix("ROWID").is_some_and(|tail| {
                            let t = tail.trim_start();
                            t.is_empty() || t.starts_with(';')
                        })
                })
            });
        if !after_ok {
            continue;
        }
        let mut before = upper[..start].trim_end();
        if let Some(b) = before.strip_suffix(',').map(str::trim_end)
            && let Some(w) = b.strip_suffix("ROWID").map(str::trim_end)
            && let Some(pre) = w.strip_suffix("WITHOUT")
        {
            before = pre.trim_end();
        }
        if !before.ends_with(')') {
            continue;
        }
        let stmt_start = before.rfind(';').map(|p| p + 1).unwrap_or(0);
        let stmt = &upper[stmt_start..before.len()];
        if is_sqlite_create_table_stmt(stmt) {
            return true;
        }
    }
    false
}

fn is_sqlite_create_table_stmt(stmt: &str) -> bool {
    let b = stmt.as_bytes();
    let mut depth = 0usize;
    let mut saw_create = false;
    let mut saw_table = false;
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'(' {
            depth += 1;
            i += 1;
        } else if b[i] == b')' {
            depth = depth.saturating_sub(1);
            i += 1;
        } else if is_ident_byte(b[i]) {
            let start = i;
            while i < b.len() && is_ident_byte(b[i]) {
                i += 1;
            }
            if depth == 0 {
                match &stmt[start..i] {
                    "CREATE" => saw_create = true,
                    "TABLE" => saw_table = true,
                    "AS" | "SELECT" => return false,
                    _ => {}
                }
            }
        } else {
            i += 1;
        }
    }
    saw_create && saw_table
}

fn strip_dollar_quotes(sample: &str) -> (String, bool) {
    let b = sample.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut saw_dollar = false;
    let mut i = 0;
    while i < b.len() {
        if let Some(tag_len) = match_dollar_tag(&b[i..]) {
            saw_dollar = true;
            if let Some(close_rel) = find_subslice(&b[i + tag_len..], &b[i..i + tag_len]) {
                let end = i + tag_len + close_rel + tag_len;
                for &ch in &b[i..end] {
                    out.push(if matches!(ch, b'\n' | b'\r') { ch } else { b' ' });
                }
                i = end;
                continue;
            }
            for &ch in &b[i..] {
                out.push(if matches!(ch, b'\n' | b'\r') { ch } else { b' ' });
            }
            break;
        }
        out.push(b[i]);
        i += 1;
    }
    (String::from_utf8(out).unwrap_or_else(|_| sample.to_string()), saw_dollar)
}

fn match_dollar_tag(bytes: &[u8]) -> Option<usize> {
    if bytes.first() != Some(&b'$') {
        return None;
    }
    if bytes.get(1) == Some(&b'$') {
        return Some(2);
    }
    let second = *bytes.get(1)?;
    if !(second.is_ascii_alphabetic() || second == b'_') {
        return None;
    }
    let mut j = 2;
    while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_') {
        j += 1;
    }
    (bytes.get(j) == Some(&b'$')).then_some(j + 1)
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn has_dollar_tag(sample: &str) -> bool {
    let b = sample.as_bytes();
    (0..b.len()).any(|i| match_dollar_tag(&b[i..]).is_some())
}
