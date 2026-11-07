/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tree-sitter Grammar Specification for AICE (AI Context Engine) 2.0.
 * Conforms to docs/AICE_SPEC.md.
 */

module.exports = grammar({
  name: "aice",

  extras: ($) => [/\s/, $.comment],

  rules: {
    source_file: ($) => repeat($._statement),

    _statement: ($) =>
      choice(
        $.module_declaration,
        $.import_statement,
        $.type_declaration,
        $.function_declaration,
        $.component_declaration,
        $.style_declaration,
        $.let_binding,
        $.assign_statement,
        $.return_statement,
        $.if_statement,
        $.match_statement,
        $.for_statement,
        $.while_statement,
        $.expression_statement
      ),

    module_declaration: ($) => seq("module", field("path", $.module_path)),
    module_path: ($) => /[a-zA-Z0-9_\-\/.]+/,

    import_statement: ($) =>
      seq("from", field("source", $.string), "import", field("specifiers", $.import_specifiers)),

    import_specifiers: ($) =>
      choice(
        seq("*", "as", $.identifier),
        commaSep1($.import_specifier)
      ),

    import_specifier: ($) =>
      seq(field("name", $.identifier), optional(seq("as", field("alias", $.identifier)))),

    type_declaration: ($) =>
      choice(
        seq("type", field("name", $.identifier), optional($.type_parameters), ":", field("body", $.type_body)),
        seq("type", field("name", $.identifier), "=", field("alias", $._type_expr))
      ),

    type_parameters: ($) => seq("[", commaSep1($.identifier), "]"),

    type_body: ($) => repeat1(choice($.field_declaration, $.enum_variant)),

    field_declaration: ($) =>
      seq(field("name", $.identifier), ":", field("type", $._type_expr)),

    enum_variant: ($) =>
      seq(field("name", $.identifier), optional(seq("(", commaSep($._type_expr), ")"))),

    function_declaration: ($) =>
      seq(
        "fn",
        field("name", $.identifier),
        field("parameters", $.parameter_list),
        optional(seq("->", field("return_type", $._type_expr))),
        choice(
          seq("=", field("body", $._expression)),
          seq(":", field("body", $.block))
        )
      ),

    parameter_list: ($) => seq("(", commaSep($.parameter), ")"),

    parameter: ($) =>
      seq(
        field("name", $.identifier),
        ":",
        field("type", $._type_expr),
        optional(seq("=", field("default", $._expression)))
      ),

    block: ($) => repeat1($._statement),

    component_declaration: ($) =>
      seq(
        "component",
        field("name", $.identifier),
        field("parameters", $.parameter_list),
        ":",
        field("layout", $.layout_block)
      ),

    layout_block: ($) => repeat1($.layout_node),

    layout_node: ($) =>
      seq(
        field("tag", $.identifier),
        optional(seq("(", commaSep($.layout_attribute), ")")),
        choice(
          seq(":", field("text", $.string)),
          seq(":", $.layout_block),
          optional(":")
        )
      ),

    layout_attribute: ($) =>
      seq(field("name", $.identifier), ":", field("value", $._expression)),

    style_declaration: ($) =>
      seq(
        "style",
        field("name", choice($.identifier, $.string)),
        ":",
        field("body", $.style_block)
      ),

    style_block: ($) => repeat1($.style_property),

    style_property: ($) =>
      seq(
        field("property", choice($.identifier, $.css_property_name)),
        ":",
        field("value", $.css_property_value)
      ),

    css_property_name: ($) => /(--)?[a-zA-Z_][a-zA-Z0-9_\-]*/,
    css_property_value: ($) => /[^\n;]+/,

    let_binding: ($) =>
      seq(
        "let",
        optional("mut"),
        field("name", $.identifier),
        optional(seq(":", field("type", $._type_expr))),
        "=",
        field("value", $._expression)
      ),

    assign_statement: ($) =>
      seq(field("target", $._expression), "=", field("value", $._expression)),

    return_statement: ($) =>
      seq(choice("ret", "return"), optional(field("value", $._expression))),

    if_statement: ($) =>
      seq(
        "if",
        field("condition", $._expression),
        ":",
        field("consequence", $.block),
        repeat($.elif_clause),
        optional($.else_clause)
      ),

    elif_clause: ($) =>
      seq("elif", field("condition", $._expression), ":", field("consequence", $.block)),

    else_clause: ($) => seq("else", ":", field("alternative", $.block)),

    match_statement: ($) =>
      seq("match", field("target", $._expression), ":", field("body", $.match_block)),

    match_block: ($) => repeat1($.match_case),

    match_case: ($) =>
      seq(
        "case",
        field("pattern", $._pattern),
        optional(seq("if", field("guard", $._expression))),
        "=>",
        field("body", choice($._expression, $.block))
      ),

    _pattern: ($) =>
      choice(
        $.literal_pattern,
        $.constructor_pattern,
        $.identifier_pattern,
        $.wildcard_pattern
      ),

    literal_pattern: ($) => $._literal,
    constructor_pattern: ($) => seq($.identifier, "(", commaSep($._pattern), ")"),
    identifier_pattern: ($) => $.identifier,
    wildcard_pattern: ($) => "_",

    for_statement: ($) =>
      seq("for", field("variable", $.identifier), "in", field("iterable", $._expression), ":", field("body", $.block)),

    while_statement: ($) =>
      seq("while", field("condition", $._expression), ":", field("body", $.block)),

    expression_statement: ($) => $._expression,

    _expression: ($) =>
      choice(
        $.binary_expression,
        $.unary_expression,
        $.postfix_try_expression,
        $.call_expression,
        $.member_expression,
        $.index_expression,
        $.record_expression,
        $.array_expression,
        $.closure_expression,
        $.identifier,
        $._literal
      ),

    binary_expression: ($) => {
      const table = [
        [prec.left, 1, choice("or", "||")],
        [prec.left, 2, choice("and", "&&")],
        [prec.left, 3, choice("==", "!=")],
        [prec.left, 4, choice("<", "<=", ">", ">=")],
        [prec.left, 5, choice("+", "-")],
        [prec.left, 6, choice("*", "/", "%")],
        [prec.right, 7, "??"],
      ];

      return choice(
        ...table.map(([fn, p, op]) =>
          fn(p, seq(field("left", $._expression), field("operator", op), field("right", $._expression)))
        )
      );
    },

    unary_expression: ($) =>
      prec(8, seq(field("operator", choice("not", "!", "-")), field("operand", $._expression))),

    postfix_try_expression: ($) => prec(9, seq(field("operand", $._expression), "?")),

    call_expression: ($) =>
      prec(10, seq(field("callee", $._expression), "(", commaSep($._expression), ")")),

    member_expression: ($) =>
      prec(11, seq(field("object", $._expression), choice(".", "?."), field("property", $.identifier))),

    index_expression: ($) =>
      prec(11, seq(field("object", $._expression), "[", field("index", $._expression), "]")),

    record_expression: ($) => seq("{", commaSep($.record_entry), "}"),

    record_entry: ($) =>
      choice(
        seq(field("key", $.identifier), ":", field("value", $._expression)),
        field("shorthand", $.identifier)
      ),

    array_expression: ($) => seq("[", commaSep($._expression), "]"),

    closure_expression: ($) =>
      seq("fn", field("parameters", $.parameter_list), choice(seq("=", $._expression), seq(":", $.block))),

    _type_expr: ($) =>
      choice(
        $.primitive_type,
        $.array_type,
        $.option_type,
        $.result_type,
        $.named_type,
        $.record_type
      ),

    primitive_type: ($) =>
      choice("int", "str", "float", "bool", "num", "byte", "char", "void", "nil"),

    array_type: ($) => seq("[", $._type_expr, "]"),
    option_type: ($) => seq("Option", "[", $._type_expr, "]"),
    result_type: ($) => seq("Result", "[", $._type_expr, ",", $._type_expr, "]"),
    named_type: ($) => seq($.identifier, optional(seq("[", commaSep1($._type_expr), "]"))),
    record_type: ($) => seq("{", commaSep($.field_declaration), "}"),

    _literal: ($) => choice($.string, $.number, $.boolean, $.nil, $.hex_color),

    string: ($) => seq('"', /([^"\\]|\\.)*/, '"'),
    number: ($) => /\d+(\.\d+)?/,
    boolean: ($) => choice("true", "false"),
    nil: ($) => "nil",
    hex_color: ($) => /#([0-9a-fA-F]{3,8})/,

    identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

    comment: ($) =>
      choice(
        seq("#", /[^\n]*/),
        seq("//", /[^\n]*/),
        seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")
      ),
  },
});

function commaSep(rule) {
  return optional(commaSep1(rule));
}

function commaSep1(rule) {
  return seq(rule, repeat(seq(",", rule)));
}
