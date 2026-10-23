// Captures go to the tracked evidence tree only when explicitly requested (CAPTURE_EVIDENCE=1);
// regular runs write to the ignored .local/test-renders so suites never rewrite committed evidence.
export const RENDERS = process.env.CAPTURE_EVIDENCE === "1" ? "docs/spec/design/renders" : ".local/test-renders";
