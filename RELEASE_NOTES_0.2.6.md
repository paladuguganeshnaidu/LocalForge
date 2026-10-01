# LOMVREN 0.2.6

This update makes the agent’s visible state more accurate and improves the chat/review experience.

- Failed edit results and non-zero terminal exit codes are surfaced as tool warnings.
- Empty model replies no longer produce a false “Task completed.” response.
- Proposed changes and plans remain visibly pending review instead of being marked as completed work.
- Assistant answers render basic Markdown, including headings, lists, inline code, and fenced code blocks.
- Proposed edits use clearer Accept changes, Review diff, and Reject actions.
- Accepted changes report validation failures accurately rather than claiming they were verified.

This is a local release candidate. A live remote GPU SSH host was not part of this verification.
