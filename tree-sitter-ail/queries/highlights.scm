; Tree-sitter syntax highlighting queries for AIL 2.0

; Keywords
[
  "module"
  "from"
  "import"
  "as"
  "type"
  "fn"
  "component"
  "style"
  "let"
  "mut"
  "ret"
  "return"
  "if"
  "elif"
  "else"
  "match"
  "case"
  "for"
  "in"
  "while"
] @keyword

; Primitive types
(primitive_type) @type.builtin

; Type declarations and references
(type_declaration name: (identifier) @type)
(named_type (identifier) @type)
(constructor_pattern (identifier) @constructor)

; Functions
(function_declaration name: (identifier) @function)
(call_expression callee: (identifier) @function.call)
(call_expression callee: (member_expression property: (identifier) @function.method.call))

; Components
(component_declaration name: (identifier) @type.component)
(layout_node tag: (identifier) @tag)
(layout_attribute name: (identifier) @attribute)

; Styles
(style_declaration name: (identifier) @tag)
(style_declaration name: (string) @tag)
(style_property property: (_) @property)
(style_property value: (_) @string.special)

; Parameters & Variables
(parameter name: (identifier) @variable.parameter)
(let_binding name: (identifier) @variable)
(assign_statement target: (identifier) @variable)
(for_statement variable: (identifier) @variable)

; Literals
(string) @string
(number) @number
(boolean) @boolean
(nil) @constant.builtin
(hex_color) @string.special.color

; Operators
[
  "+"
  "-"
  "*"
  "/"
  "%"
  "=="
  "!="
  "<"
  "<="
  ">"
  ">="
  "and"
  "or"
  "not"
  "&&"
  "||"
  "!"
  "??"
  "?"
  "="
  "->"
  "=>"
] @operator

; Punctuation
[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  ":"
  ","
  "."
  "?."
] @punctuation.delimiter

; Comments
(comment) @comment
