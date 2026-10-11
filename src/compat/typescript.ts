/**
 * Compatibility shim providing the TypeScript AST & Compiler API.
 * In TypeScript 7+, the compiler binary is native; the AST parser is provided via typescript-legacy.
 */
import ts from "typescript-legacy";
export default ts;
