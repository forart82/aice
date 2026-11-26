pub mod bash;
mod bash_abort;
mod bash_abort_bounds;
mod bash_abort_cond;
mod bash_abort_flat;
mod bash_bt;
mod bash_cmd_helpers;
mod bash_comment;
mod bash_deps;
mod bash_deps_hd;
mod bash_deps_hd_case;
mod bash_deps_walk;
mod bash_desync;
pub(crate) mod bash_hd_bt;
mod bash_hd_cond;
mod bash_hd_delim;
mod bash_hd_desync;
mod bash_hd_meta;
mod bash_hd_norm;
mod bash_hd_norm_step;
mod bash_hd_unq;
mod bash_heredoc;
mod bash_subst;
mod bash_subst_scan;
mod bash_time_bounds;
mod bash_time_brace;
pub mod c_lang;
pub mod checks;
pub mod checks_lang;
pub mod checks_markup;
pub mod checks_tags;
pub mod cpp_lang;
pub mod csharp;
pub mod css;
pub mod cst_helpers;
pub mod dart_lang;
pub mod dep_extract;
pub mod dep_helpers;
pub mod firewall_delta;
pub mod firewall_mid;
pub mod go_lang;
pub mod html;
pub mod java_lang;
pub mod javascript;
pub mod json;
pub mod kotlin;
pub mod markdown;
pub mod php_lang;
pub mod python;
pub mod ruby_lang;
pub mod rust_lang;
pub mod snippet_blk;
pub mod snippet_cache;
pub mod snippet_closed;
pub mod snippet_container;
pub mod snippet_container_compat;
pub mod snippet_cst;
pub mod snippet_ctx;
pub mod snippet_ctx_bash;
pub mod snippet_ctx_scan;
pub mod snippet_del;
pub mod snippet_del_lang;
pub mod snippet_del_suf;
pub mod snippet_del_win;
pub mod snippet_del_xml;
pub mod snippet_diff;
pub mod snippet_eof;
pub mod snippet_eof_ctx;
pub mod snippet_hdr;
pub mod snippet_hdr_ts;
pub mod snippet_hunk;
pub mod snippet_js_decl;
pub mod snippet_js_lex;
pub mod snippet_js_punct;
pub mod snippet_js_step;
pub mod snippet_lex;
pub mod snippet_lit;
pub mod snippet_ml_extra;
pub mod snippet_ml_lit;
pub mod snippet_omissions;
pub mod snippet_ops;
pub mod snippet_probe;
pub mod snippet_rs_angle;
pub mod snippet_rs_attr;
pub mod snippet_rs_blk;
pub mod snippet_rs_hdr;
pub mod snippet_rs_probe;
pub mod snippet_rs_tail;
pub mod snippet_semi_op;
pub mod snippet_synth;
pub mod snippet_ts_brace;
pub mod snippet_ts_cast;
pub mod snippet_ts_cls;
pub mod snippet_ts_expr;
pub mod snippet_ts_gen;
pub mod snippet_ts_gen_ambig;
pub mod snippet_ts_gen_chk;
pub mod snippet_ts_gen_close;
pub mod snippet_ts_gen_ctx;
pub mod snippet_ts_hdr;
pub mod snippet_ts_multi;
pub mod snippet_ts_ret;
pub mod snippet_ts_type;
pub mod snippet_type_body;
pub mod toml;
pub mod twig_branch_expand;
pub mod twig_branch_fallback;
pub mod twig_branches;
pub mod twig_html;
pub mod twig_html_balance;
pub mod twig_html_eval;
pub mod twig_html_scan;
pub mod twig_html_tree;
pub mod twig_lexer;
pub mod twig_parser;
pub mod twig_rd;
pub mod twig_tag_validators;
pub mod twig_tags;
pub mod typescript;
pub mod xml;
pub mod yaml;
use crate::AdapterBundle;

pub fn all_adapters() -> Vec<Box<dyn AdapterBundle>> {
    vec![
        Box::new(json::JsonAdapter),
        Box::new(yaml::YamlAdapter),
        Box::new(toml::TomlAdapter),
        Box::new(markdown::MarkdownAdapter),
        Box::new(html::HtmlAdapter),
        Box::new(css::CssAdapter),
        Box::new(xml::XmlAdapter),
        Box::new(bash::BashAdapter),
        Box::new(rust_lang::RustAdapter),
        Box::new(typescript::TypeScriptAdapter),
        Box::new(typescript::TsxAdapter),
        Box::new(javascript::JavaScriptAdapter),
        Box::new(python::PythonAdapter),
        Box::new(go_lang::GoAdapter),
        Box::new(c_lang::CAdapter),
        Box::new(cpp_lang::CppAdapter),
        Box::new(csharp::CSharpAdapter),
        Box::new(java_lang::JavaAdapter),
        Box::new(kotlin::KotlinAdapter),
        Box::new(dart_lang::DartAdapter),
        Box::new(php_lang::PhpAdapter),
        Box::new(ruby_lang::RubyAdapter),
        Box::new(twig_parser::TwigAdapter),
    ]
}
