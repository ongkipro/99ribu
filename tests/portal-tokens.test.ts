import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/** S159: the portals (/akun, /afiliasi) use shared tokens only: no literal colour, no inline style object. */
const TARGETS = [
	"src/app/styles/13-account.css",
	"src/app/styles/14-affiliate.css",
	"src/components/storefront/account",
	"src/components/storefront/affiliate",
	"src/components/storefront/buyer-account-client.tsx",
	"src/components/storefront/profile-completion.tsx",
	"src/app/(storefront)/akun",
	"src/app/(storefront)/afiliasi",
];

const FN = "(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)";
const NAMES =
	"(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|gold|navy|teal|maroon|lime|aqua|cyan|magenta|brown|beige|ivory|olive|fuchsia|crimson|coral|salmon|violet|indigo|khaki|tan|tomato)";
// Valid colour hex lengths only (3, 4, 6, 8): `#face` with five digits or `#abcde` is not a colour.
const HEX = "#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])";
const CSS_HEX = new RegExp(`(^|[^\\w&])${HEX}`, "g");
const CSS_FN = new RegExp(`\\b${FN}\\(`, "gi");
const CSS_NAME = new RegExp(`(?<![\\w#.-])${NAMES}(?![\\w-])`, "gi");
const TW_ARBITRARY = new RegExp(
	`\\b[a-z][a-z-]*-\\[[^\\]\\s]*(?:${HEX}|\\b${FN}\\(|\\b(?:color:)?${NAMES}\\b)[^\\]]*\\]`,
	"i",
);
const QUOTED_FN = /["'`][^"'`]*\b(?:rgba?|hsla?|hwb|oklab|oklch|lab|lch)\(/;
const QUOTED_HEX = new RegExp(`(["'\`])${HEX}\\1`);
// A fragment or id reference, not a colour: `href="#face"`, `id="#fade"`.
const NOT_A_COLOUR = /\b(?:href|to|src|id|htmlFor|hash|aria-[a-z]+|data-[a-z-]+)\s*[=:]\s*\{?\s*["'`]#/;

/** Replace comments with blanks of the same shape so line numbers survive. */
function stripComments(text: string, css: boolean): string {
	const blank = (m: string) => m.replace(/[^\n]/g, " ");
	const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, blank);
	return css ? noBlock : noBlock.replace(/(^|\s)\/\/[^\n]*/g, blank);
}

/** Drop everything that can legitimately hold colour-like words: var(), url(), quoted strings. */
function cssValue(value: string): string {
	let out = value.replace(/(["'])(?:\\.|(?!\1).)*\1/g, "''");
	for (let prev = ""; prev !== out; ) {
		prev = out;
		out = out.replace(/\b(?:var|url)\([^()]*\)/gi, "");
	}
	return out;
}

export function scanSource(name: string, text: string): string[] {
	const found: string[] = [];
	const css = /\.css$/.test(name);
	stripComments(text, css)
		.split("\n")
		.forEach((code, i) => {
			const at = `${name}:${i + 1}`;
			if (css) {
				// Declaration values only: selectors such as `#face` or `a:hover` are not colours.
				for (const decl of code.matchAll(/[\w-]+\s*:\s*([^;{}]+)(?=[;}]|$)/g)) {
					const value = cssValue(decl[1] ?? "");
					for (const re of [CSS_HEX, CSS_FN, CSS_NAME]) {
						re.lastIndex = 0;
						for (const m of value.matchAll(re)) found.push(`${at} colour ${m[0].trim()}`);
					}
				}
				return;
			}
			if (/\bstyle\s*=\s*\{/.test(code)) found.push(`${at} inline style`);
			else if (TW_ARBITRARY.test(code)) found.push(`${at} arbitrary colour utility`);
			else if (QUOTED_FN.test(code)) found.push(`${at} colour function`);
			else if (QUOTED_HEX.test(code) && !NOT_A_COLOUR.test(code)) found.push(`${at} literal hex`);
		});
	return found;
}

function files(path: string): string[] {
	if (!statSync(path).isDirectory()) return [path];
	return readdirSync(path).flatMap((f) => files(join(path, f)));
}

test("scanner flags a literal colour and an inline style", () => {
	assert.equal(scanSource("x.css", "a { color: #fff; }").length, 1);
	assert.equal(scanSource("x.css", "a { background: rgba(0, 0, 0, .04); }").length, 1);
	assert.equal(scanSource("x.css", "a { color: var(--text-muted); }").length, 0);
	assert.equal(scanSource("x.tsx", "<div style={{ gap: 4 }} />").length, 1);
	assert.equal(scanSource("x.tsx", 'const c = "#153d72";').length, 1);
	assert.equal(scanSource("x.tsx", '<div className="a" />').length, 0);
});

test("scanner flags Tailwind arbitrary colours, named colours and style objects", () => {
	assert.equal(scanSource("x.tsx", '<div className="bg-[#fff] p-2" />').length, 1);
	assert.equal(scanSource("x.tsx", '<div className="text-[rgb(0,0,0)]" />').length, 1);
	assert.equal(scanSource("x.tsx", '<div className="border-[color:#abc]" />').length, 1);
	assert.equal(scanSource("x.tsx", '<div className="bg-[white]" />').length, 1);
	assert.equal(scanSource("x.tsx", "<div style={box} />").length, 1);
	assert.equal(scanSource("x.tsx", "<div style = {box} />").length, 1);
	assert.equal(scanSource("x.tsx", 'const c = "rgba(0, 0, 0, .1)";').length, 1);
	assert.equal(scanSource("x.css", "a { color: white; }").length, 1);
	assert.equal(scanSource("x.css", "a { border: 1px solid black; }").length, 1);
	assert.equal(scanSource("x.css", "a { background: linear-gradient(red, var(--brand)); }").length, 1);
	assert.equal(scanSource("x.css", "a { color: #FFF }").length, 1);
});

test("scanner ignores tokens, comments and hex-like non-colours", () => {
	assert.equal(scanSource("x.css", "a { color: var(--white, var(--text)); }").length, 0);
	assert.equal(scanSource("x.css", "a { background: url(/img/black.svg) var(--surface); }").length, 0);
	assert.equal(scanSource("x.css", "a { content: 'white'; color: transparent; }").length, 0);
	assert.equal(scanSource("x.css", "/* old: #fff,\n   color: white;\n   rgb(0,0,0) */\na { color: var(--text); }").length, 0);
	assert.equal(scanSource("x.css", "a:hover #face { margin: 0; }").length, 0);
	assert.equal(scanSource("x.tsx", '<a href="#face">Lompat</a>').length, 0);
	assert.equal(scanSource("x.tsx", '<a href="#fade">Lompat</a>').length, 0);
	assert.equal(scanSource("x.tsx", 'const hash = "#abcde";').length, 0);
	assert.equal(scanSource("x.tsx", "/* style={{ a: 1 }}\n bg-[#fff] */\n<div className=\"p-2\" />").length, 0);
	assert.equal(scanSource("x.tsx", '<div className="bg-surface-muted text-white" />').length, 0);
	assert.equal(scanSource("x.tsx", "// style={box} is banned\nconst a = 1;").length, 0);
});

test("portal CSS and components carry no literal colour or inline style", () => {
	const hits = TARGETS.flatMap(files)
		.filter((f) => /\.(css|tsx?)$/.test(f))
		.flatMap((f) => scanSource(f, readFileSync(f, "utf8")));
	assert.deepEqual(hits, []);
});
