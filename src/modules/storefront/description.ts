// Product description text -> blocks. Catalog descriptions are plain text with "\n" breaks: "- item" and
// "1.item" lines are lists, a blank line separates paragraphs. Rendering lists as real lists gives them a
// hanging indent (wrapped lines align under the text, not under the marker).
// `id` is the source line number of the block's (or item's) first line: a stable, unique React key.
export type DescriptionBlock =
	| { kind: "text"; id: number; text: string; gap: boolean }
	| { kind: "bullets"; id: number; items: { id: number; text: string }[]; gap: boolean }
	| { kind: "numbers"; id: number; items: { id: number; value: number; text: string }[]; gap: boolean };

const BULLET = /^\s*[-•*]\s+(\S.*)$/u;
// "1. x", "2) x" and the "3.x" the supplier text uses; "1.5MM" is not a marker (a digit follows).
const NUMBER = /^\s*(\d{1,3})[.)]\s*([^\s\d].*)$/u;

export function describeBlocks(text: string): DescriptionBlock[] {
	const blocks: DescriptionBlock[] = [];
	let gap = false;
	for (const [id, raw] of text.replace(/\r\n?/g, "\n").split("\n").entries()) {
		const line = raw.trim();
		if (!line) {
			gap = blocks.length > 0;
			continue;
		}
		const bullet = BULLET.exec(line), number = bullet ? null : NUMBER.exec(line);
		const last = blocks.at(-1);
		if (bullet) {
			if (last?.kind === "bullets" && !gap) last.items.push({ id, text: bullet[1] });
			else blocks.push({ kind: "bullets", id, items: [{ id, text: bullet[1] }], gap });
		} else if (number) {
			const item = { id, value: Number(number[1]), text: number[2] };
			if (last?.kind === "numbers" && !gap) last.items.push(item);
			else blocks.push({ kind: "numbers", id, items: [item], gap });
		} else blocks.push({ kind: "text", id, text: line, gap });
		gap = false;
	}
	return blocks;
}

// Lower bound of the rendered line count: at CHARS_PER_LINE or more characters per line (wider than the
// buy box ever is), so a text this long really passes the clamp and the fade/"Baca selengkapnya" never
// shows over text that fits.
const CHARS_PER_LINE = 70;
export function descriptionLines(blocks: readonly DescriptionBlock[]) {
	const lines = (text: string) => Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
	return blocks.reduce((sum, block) => sum + (block.gap ? 1 : 0)
		+ (block.kind === "text" ? lines(block.text) : block.items.reduce((n, item) => n + lines(item.text), 0)), 0);
}
export const DESCRIPTION_CLAMP_LINES = 8;
