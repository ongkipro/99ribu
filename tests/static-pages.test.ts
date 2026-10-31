import assert from "node:assert/strict";
import { test } from "node:test";
import { pageBlocks } from "../src/modules/storefront/static-pages.ts";

test("store page markup: paragraphs, headings and lists, never HTML", () => {
  const blocks = pageBlocks("Halo pembeli,\nbaris dua.\n\n## Pengiriman\nDikirim dari gudang.\n- Satu\n- Dua\n\n<script>x</script>");
  assert.deepEqual(blocks.map((b) => b.kind), ["paragraph", "heading", "paragraph", "list", "paragraph"]);
  assert.equal((blocks[0] as { text: string }).text, "Halo pembeli, baris dua.");
  assert.deepEqual((blocks[3] as { items: { text: string }[] }).items.map((i) => i.text), ["Satu", "Dua"]);
  // Markup arrives as text: React escapes it.
  assert.equal((blocks[4] as { text: string }).text, "<script>x</script>");
  assert.equal(new Set(blocks.map((b) => b.key)).size, blocks.length);
});
