# LOMVREN 0.2.12

## Agent recovery and run transparency

- An invalid edit or failed command now causes the agent to re-evaluate the tool result and retry up to two times.
- A successful retry of the same target resolves the blocker; unresolved failures leave the turn failed and visible.
- Expandable run details now include visible model responses as well as tool inputs and results. Hidden chain-of-thought is not exposed.
