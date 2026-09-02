# /agentic-verify - Close The Cycle With Real Evidence

1. Check what is still awaiting a report:
   ```bash
   agentic status
   ```

2. Report any task you have finished but not yet reported:
   ```bash
   agentic report <TASK-ID> --status completed --commit <sha>
   ```

3. Collect evidence, verify and close:
   ```bash
   agentic verify
   ```

Interpret the outcome honestly:
- `COMPLETE` - requirements closed against evidence; report the evidence id.
- `FAIL` / `REMEDIATING` - the suite or an acceptance criterion failed. Fix and re-verify.
- `BLOCKED` - closure refused (no executable evidence, or missing acceptance criteria). Say so.
