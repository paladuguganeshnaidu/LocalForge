# LOMVREN 0.3.0 local checkpoint

This checkpoint preserves the 2026-10-04 UI/load, saved-edit recovery and evidence-driven verification work before the requested 1.0.0 release work. It is not a production or Marketplace certification.

- Baseline TypeScript/full regression suite: 408 passed, zero failures, skips or cancellations, in `verification-feedback-final-full-20261004.log`.
- Actual Chrome chat UI/load test: `chat-ui-verification-feedback-20261004/result.json`. Whole-reply Markdown renders as headings/lists; code remains escaped. Narrow/wide layouts, model/mode/file controls, popovers, streaming and cancellation checks passed.
- GPU-backed tiny website: `micro-website-gpu-auto-verify-20261004/result.json`. Real agent-owned server, automatic registered browser checks, model-authored semantic repair and independent runtime/interaction/responsive verification passed. The file has 36 lines rather than the test prompt's 25-line limit; do not claim complete instruction compliance or full production website acceptance.
- GPU-backed Node task: `graduated-node-gpu-auto-verify-20261004/result.json` failed. Automatic rerun exposed the model's CommonJS/ESM repair error rather than falsely accepting saved source. Concrete post-repair diagnostics were then added; fresh retest remains separate evidence.
- Legacy tool inventory: 42 executable names, not 100 independent tools. Full NexusFlow/3D, ML/document workflow and real approval-button acceptance remain outstanding.

The evidence root is `C:\Users\ganes\Documents\Codex\NexusFlow-agent-tests`. Existing older logs and VSIX artifacts are retained. The checkpoint VSIX contains runtime, browser dependency and Marketplace metadata; it is not a backup of every working-tree source file. No 1.0.0 success or publishing is implied by this version number.
