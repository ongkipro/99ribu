# Historical independent visual evidence

Reports and contexts are unchanged historical outputs, not current acceptance. The review tool reuses `design/review-slices` filenames between revisions, so original links in an old report can refer to later pixels. Use the corresponding version directory and its SHA-256 mapping:

- `s08.md`: `s08-slices/` and unchanged `docs/spec/design/renders/s08/`.
- `s21-round1.md` and `s21-round1-design.md`: `s21-round1-slices/`.
- `s21-round2.md` and `s21-round2-design.md`: `s21-round2-slices/` and `s21-round2-renders/`.
- `s08-s21-review-rounds.log` preserves the original five-round history. No fresh cycle starts without the requested owner decision.

Current acceptance remains the generated `design/review.md` bound to the canonical design context and current raw captures. Archived findings are never relabeled as approval.

`s21-source.md` preserves the actual independent Claude Code source/contract APPROVE at digest `7a42345e9ccc0d958c8585174fcc32869ed2b8ee17c66aa56b47bd8443d3de17`. It is not visual approval; `design/review.md` remains the visual verdict authority.
