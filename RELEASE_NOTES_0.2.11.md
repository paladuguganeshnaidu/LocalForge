# LOMVREN 0.2.11

## Persistent run history

- Recent agent activity is stored in workspace state and restored when the chat view is reopened.
- Run details remain expandable, including sanitized tool inputs and outputs.
- Incomplete runs are visibly marked as interrupted rather than appearing successful.
- Retention is bounded to recent turns and activity details; conversation messages and file contents are not duplicated into this trace store.
