import { AccessError } from "../modules/access/policy.ts";

export type ImageContentType = "image/jpeg" | "image/png" | "image/webp";
export type ScanStatus = "ready" | "pending_scan" | "rejected";

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
	bytes.byteLength >= offset + signature.length &&
	signature.every((value, index) => bytes[offset + index] === value);

// Content type comes from magic bytes only; client-declared types are never trusted.
export function sniffImageContentType(bytes: Uint8Array): ImageContentType {
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return "image/png";
	}
	if (
		startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
	) {
		return "image/webp";
	}
	throw new AccessError(400, "INVALID_IMAGE_FORMAT");
}

// ISO BMFF: 4-byte box size followed by the "ftyp" box type.
export function sniffImageOrMp4ContentType(
	bytes: Uint8Array,
): ImageContentType | "video/mp4" {
	if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) return "video/mp4";
	return sniffImageContentType(bytes);
}

// lazy: marker-based local scanner; swap for a real malware scanner adapter before remote activation.
export function scanImagePayload(bytes: Uint8Array): ScanStatus {
	const ascii = Buffer.from(
		bytes.subarray(0, Math.min(bytes.byteLength, 4096)),
	).toString("latin1");
	if (
		ascii.includes("<script") ||
		ascii.includes("<!DOCTYPE html") ||
		ascii.includes("<svg")
	) {
		throw new AccessError(400, "DANGEROUS_IMAGE_CONTENT");
	}
	if (ascii.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) return "rejected";
	if (ascii.includes("SUPPORT_ATTACHMENT_PENDING_SCAN")) return "pending_scan";
	return "ready";
}

// Reads only RIFF/WebP headers (VP8, VP8L, VP8X); no decoder dependency.
export function webpSize(bytes: Uint8Array) {
	const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const bad = () => new AccessError(400, "INVALID_IMAGE_FORMAT");
	if (view.length < 30 || view.toString("latin1", 0, 4) !== "RIFF" || view.toString("latin1", 8, 12) !== "WEBP") throw bad();
	const chunk = view.toString("latin1", 12, 16);
	if (chunk === "VP8 ") {
		if (view[23] !== 0x9d || view[24] !== 0x01 || view[25] !== 0x2a) throw bad();
		return { width: view.readUInt16LE(26) & 0x3fff, height: view.readUInt16LE(28) & 0x3fff };
	}
	if (chunk === "VP8L") {
		if (view[20] !== 0x2f) throw bad();
		const bits = view.readUInt32LE(21);
		return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
	}
	if (chunk === "VP8X") return { width: view.readUIntLE(24, 3) + 1, height: view.readUIntLE(27, 3) + 1 };
	throw bad();
}
