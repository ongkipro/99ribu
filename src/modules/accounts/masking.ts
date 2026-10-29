// Display-only masking for account contact values (no I/O, safe in client components).

/** `a•••@domain` for a local part of 3 or more characters, `•••@domain` below that (one letter would be the whole name). */
export function maskedEmail(stored: string | null | undefined) {
	if (!stored) return null;
	const at = stored.lastIndexOf("@");
	if (at < 1) return "•••";
	const local = Array.from(stored.slice(0, at));
	const head = local.length >= 3 ? local[0] : "";
	return `${head}•••${stored.slice(at)}`;
}
