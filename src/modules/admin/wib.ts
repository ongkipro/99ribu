// Staff enter operational times in WIB (Asia/Jakarta, UTC+7, no DST) whatever the device
// timezone. Pure helpers; the server still refuses future or pre-handover instants.
const INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** `datetime-local` value read as WIB → ISO instant; null when not a real calendar time. */
export function wibInputToIso(value: string): string | null {
	const m = INPUT.exec(value);
	if (!m) return null;
	const [year, month, day, hour, minute, second] = m.slice(1).map((part) => Number(part ?? 0));
	const utc = Date.UTC(year, month - 1, day, hour - 7, minute, second);
	// Reject rollovers such as 2026-02-30 or 24:00 by round-tripping the wall time.
	const wall = new Date(utc + 7 * 3600_000);
	if (wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day ||
		wall.getUTCHours() !== hour || wall.getUTCMinutes() !== minute || second > 59) return null;
	return new Date(utc).toISOString();
}
