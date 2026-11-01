import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Docs drift guard (S155): every tracked Markdown file needs an H1 or front matter, and every relative link
// must resolve to a file or directory on disk. Archives and generated review output are skipped (docs/history keeps old text as written; design/review* and docs/spec/design/reviews are tool output).
const files = execFileSync("git", ["ls-files", "*.md"], { encoding: "utf8" })
	.split("\n")
	.filter((file) => file && !file.startsWith("docs/history/") && !file.startsWith("design/review") && !file.includes("/design/reviews/") && !file.startsWith("node_modules/"));

const problems: string[] = [];
for (const file of files) {
	const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
	if (!/^#\s+\S/m.test(text) && !text.startsWith("---")) problems.push(`${file}: no H1 and no front matter`);
	for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
		const target = match[1].split("#")[0];
		if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
		if (!existsSync(join(dirname(file), decodeURIComponent(target)))) problems.push(`${file}: broken link ${match[1]}`);
	}
}
if (problems.length > 0) {
	console.error(`docs:check found ${problems.length} problem(s); fix the link or the file named below:\n${problems.join("\n")}`);
	process.exit(1);
}
console.log(`docs:check ok (${files.length} Markdown files)`);
