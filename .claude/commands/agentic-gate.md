# /agentic-gate - Human Gate Decisions

1. List what is blocking:
   ```bash
   agentic gate list
   ```

2. For each gate, present the risk to the user in plain language: what it protects, what the
   run intends to do, and what happens if it is approved. Do **not** decide on their behalf.

3. Record their decision:
   ```bash
   agentic gate approve <GATE-ID> --note "<rationale>"
   agentic gate reject  <GATE-ID> --note "<rationale>"
   ```

4. Continue the run:
   ```bash
   agentic run
   ```
