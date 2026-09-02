# /agentic-grill - Deterministic Probing And Decision Recording

> Named `/agentic-grill` on purpose: `/grill-me` belongs to the `mattpocock/skills`
> pack and conducts the live interview. This command produces the probe set and
> records the ADR. Use them together: probes here, conversation there.

Interrogate `$*` before any code is written.

1. Run the probes:
   ```bash
   agentic grill "$*"
   ```

2. Read the report. Every probe marked **ASSUMED DEFAULT** is an open question, not a decision.

3. Put the real answers to the user as concrete options with trade-offs. If `/grill-me`
   (from `mattpocock/skills`) is installed, use it to conduct that interview. Collect the
   choices into an answers file:
   ```json
   { "GRILL-001": "...", "GRILL-003": "..." }
   ```

4. Ratify the decisions (this promotes the ADR from PROPOSED to ACCEPTED):
   ```bash
   agentic grill "$*" --answers answers.json
   ```

5. Only then deliver:
   ```bash
   agentic prompt "$*" --answers answers.json
   ```
