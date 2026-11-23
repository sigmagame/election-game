#!/usr/bin/env node
/**
 * Verifies that a formatting-only change (Prettier, a manual re-indent, ...) did not change what
 * the code means.
 *
 * Every TypeScript/JavaScript file is parsed twice, once from the baseline and once from the
 * working tree, and the two syntax trees are compared. Differences that cannot change behaviour
 * are ignored: whitespace and line breaks, comments, quote style, trailing commas, semicolons,
 * redundant parentheses, `{"x"}` vs "x" in JSX attributes, and JSX whitespace that React discards.
 * Anything else (a changed operator, identifier, literal, JSX text, statement order, ...) is
 * reported with its file and line numbers.
 *
 * Usage:
 *   node scripts/verify-format-only.mjs                 compare the working tree with git HEAD
 *   node scripts/verify-format-only.mjs --against DIR   compare with a backup copy of the project
 *
 * Exit code: 0 = identical meaning, 1 = a difference or a syntax error, 2 = some files had no
 * baseline to compare against (commit your work first, or use --against).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "out", "build", "coverage"]);

const args = process.argv.slice(2);
const againstIndex = args.indexOf("--against");
const againstDir = againstIndex >= 0 ? path.resolve(args[againstIndex + 1] ?? "") : null;
if (againstDir && !existsSync(againstDir)) {
  console.error(`Baseline directory not found: ${againstDir}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// File discovery and baseline lookup
// ---------------------------------------------------------------------------------------------

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function discoverFiles() {
  const files = [];
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && SOURCE_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      files.push(path.join(ROOT, entry.name));
    }
  }
  for (const dir of ["src", "scripts"]) {
    if (existsSync(path.join(ROOT, dir))) walk(path.join(ROOT, dir), files);
  }
  return files.sort();
}

function readBaseline(rel) {
  if (againstDir) {
    const file = path.join(againstDir, rel);
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  }
  try {
    return execFileSync("git", ["show", `HEAD:${rel.split(path.sep).join("/")}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null; // not tracked at HEAD
  }
}

// ---------------------------------------------------------------------------------------------
// Canonical syntax tree
// ---------------------------------------------------------------------------------------------

function scriptKindFor(name) {
  if (name.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (name.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?ts$/.test(name)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function parse(text, name) {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, scriptKindFor(name));
}

function numberText(text) {
  const n = Number(text.replace(/_/g, ""));
  return Number.isFinite(n) ? String(n) : text;
}

/** React's JSX whitespace rules: trim lines, drop empty ones, join the rest with single spaces. */
function cleanJsxText(text) {
  const lines = text.split(/\r\n|\n|\r/);
  let lastNonEmpty = -1;
  lines.forEach((line, i) => {
    if (/[^ \t]/.test(line)) lastNonEmpty = i;
  });
  let result = "";
  lines.forEach((line, i) => {
    let t = line.replace(/\t/g, " ");
    if (i !== 0) t = t.replace(/^ +/, "");
    if (i !== lines.length - 1) t = t.replace(/ +$/, "");
    if (t) {
      if (i !== lastNonEmpty) t += " ";
      result += t;
    }
  });
  return result;
}

const PROPERTY_NAME_OWNERS = [
  ts.isPropertyAssignment,
  ts.isPropertyDeclaration,
  ts.isPropertySignature,
  ts.isMethodDeclaration,
  ts.isMethodSignature,
  ts.isGetAccessorDeclaration,
  ts.isSetAccessorDeclaration,
  ts.isEnumMember,
];

function isPropertyName(node) {
  const parent = node.parent;
  return (
    parent !== undefined &&
    parent.name === node &&
    PROPERTY_NAME_OWNERS.some((test) => test(parent)) &&
    (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node))
  );
}

function lineOf(node, sf) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function make(kind, value, children, line) {
  return { k: kind, v: value, c: children, l: line };
}

function isPlainString(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function jsxChildren(children, sf) {
  const result = [];
  const pushText = (text, line) => {
    if (!text) return;
    const last = result[result.length - 1];
    if (last && last.k === "#text") last.v += text;
    else result.push(make("#text", text, [], line));
  };
  const collapse = () => {
    // Formatters re-flow JSX text, so runs of spaces are compared as one (as a browser renders them).
    for (const piece of result) if (piece.k === "#text") piece.v = piece.v.replace(/\s+/g, " ");
  };
  for (const child of children) {
    if (ts.isJsxText(child)) {
      pushText(cleanJsxText(child.text), lineOf(child, sf));
    } else if (ts.isJsxExpression(child) && !child.dotDotDotToken) {
      const expr = child.expression;
      if (!expr) continue; // {/* comment */} renders nothing
      if (isPlainString(expr)) pushText(expr.text, lineOf(child, sf));
      else result.push(canon(child, sf));
    } else {
      result.push(canon(child, sf));
    }
  }
  collapse();
  return result;
}

function canon(node, sf) {
  // Redundant parentheses are the formatter's business; required ones are kept in the tree shape.
  if (ts.isParenthesizedExpression(node)) return canon(node.expression, sf);
  if (ts.isParenthesizedTypeNode(node)) return canon(node.type, sf);

  const line = lineOf(node, sf);

  if (isPropertyName(node)) {
    return make("PropertyName", ts.isNumericLiteral(node) ? numberText(node.text) : node.text, [], line);
  }

  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
    const open = ts.isJsxElement(node) ? node.openingElement : node.openingFragment;
    const close = ts.isJsxElement(node) ? node.closingElement : node.closingFragment;
    return make(
      ts.SyntaxKind[node.kind],
      undefined,
      [canon(open, sf), ...jsxChildren(node.children, sf), canon(close, sf)],
      line,
    );
  }

  if (ts.isJsxAttribute(node)) {
    let value = null;
    const init = node.initializer;
    if (init) {
      const plain =
        ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression)
          ? init.expression
          : init;
      value = ts.isStringLiteral(plain)
        ? make("StringLiteral", plain.text, [], lineOf(plain, sf))
        : canon(init, sf);
    }
    return make("JsxAttribute", undefined, [canon(node.name, sf), value], line);
  }

  let value;
  switch (node.kind) {
    case ts.SyntaxKind.Identifier:
    case ts.SyntaxKind.PrivateIdentifier:
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.RegularExpressionLiteral:
    case ts.SyntaxKind.TemplateHead:
    case ts.SyntaxKind.TemplateMiddle:
    case ts.SyntaxKind.TemplateTail:
      value = node.text;
      break;
    case ts.SyntaxKind.NumericLiteral:
      value = numberText(node.text);
      break;
    case ts.SyntaxKind.BigIntLiteral:
      value = node.text.toLowerCase();
      break;
    case ts.SyntaxKind.PrefixUnaryExpression:
    case ts.SyntaxKind.PostfixUnaryExpression:
      value = node.operator;
      break;
    case ts.SyntaxKind.VariableDeclarationList:
      value = node.flags & ts.NodeFlags.BlockScoped;
      break;
    default:
      if ("isTypeOnly" in node) value = Boolean(node.isTypeOnly);
  }

  const children = [];
  ts.forEachChild(node, (child) => {
    const isJsDoc =
      child.kind >= ts.SyntaxKind.FirstJSDocNode && child.kind <= ts.SyntaxKind.LastJSDocNode;
    if (!isJsDoc && child.kind !== ts.SyntaxKind.EmptyStatement) children.push(canon(child, sf));
  });
  return make(ts.SyntaxKind[node.kind], value, children, line);
}

// ---------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function firstDifference(a, b, trail = []) {
  if (a === null || b === null) return a === b ? null : { trail, a, b };
  if (a.k !== b.k || !sameValue(a.v, b.v)) return { trail, a, b };
  const here = [...trail, a.k];
  const count = Math.max(a.c.length, b.c.length);
  for (let i = 0; i < count; i += 1) {
    const left = a.c[i] ?? null;
    const right = b.c[i] ?? null;
    if (left === null && right === null) continue; // e.g. both sides are a bare JSX attribute
    if (left === null || right === null) return { trail: here, a: left, b: right };
    const found = firstDifference(left, right, here);
    if (found) return found;
  }
  return null;
}

function describe(node) {
  if (!node) return "(nothing)";
  const value = node.v === undefined ? "" : ` ${JSON.stringify(node.v)}`;
  return `${node.k}${value} (line ${node.l})`;
}

function syntaxErrors(sf) {
  return (sf.parseDiagnostics ?? []).length;
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

let compared = 0;
let different = 0;
const noBaseline = [];

for (const file of discoverFiles()) {
  const rel = path.relative(ROOT, file);
  const baseline = readBaseline(rel);
  if (baseline === null) {
    noBaseline.push(rel);
    continue;
  }
  compared += 1;

  const before = parse(baseline, rel);
  const after = parse(readFileSync(file, "utf8"), rel);

  if (syntaxErrors(after) > 0) {
    different += 1;
    console.log(`FAIL ${rel}: the working copy has ${syntaxErrors(after)} syntax error(s)`);
    continue;
  }

  const found = firstDifference(canon(before, before), canon(after, after));
  if (found) {
    different += 1;
    const context = found.trail.slice(-4).join(" > ");
    console.log(`FAIL ${rel}`);
    console.log(`     in:       ${context || "SourceFile"}`);
    console.log(`     baseline: ${describe(found.a)}`);
    console.log(`     current:  ${describe(found.b)}`);
  }
}

console.log(`\nCompared ${compared} file(s): ${compared - different} equivalent, ${different} different.`);

if (noBaseline.length > 0) {
  console.log(
    `\n${noBaseline.length} file(s) had no baseline and were NOT verified` +
      (againstDir ? "." : " (not tracked at git HEAD: commit your work first, or use --against DIR)."),
  );
  for (const rel of noBaseline.slice(0, 10)) console.log(`  - ${rel}`);
  if (noBaseline.length > 10) console.log(`  ... and ${noBaseline.length - 10} more`);
}

if (different > 0) process.exit(1);
if (noBaseline.length > 0) process.exit(2);
console.log("OK: formatting changes did not alter the code's meaning.");
