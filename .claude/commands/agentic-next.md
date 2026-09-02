# /agentic-next - What To Do Now

```bash
agentic next
```

It resolves the single next step from the real state: initialize, migrate stale artifacts,
decide a pending gate, implement an awaiting task, verify, or start the next phase.

Relay the answer as it is, then do it:
- **implement** - open the prompt pack it names and follow it (TDD, owned paths only).
- **decide_gate** / **migrate** / **update_cli** - these need a human; explain and stop.
- **verify** / **advance_milestone** - safe to run; `agentic next --run` executes them.
