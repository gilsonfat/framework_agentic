# /agentic-grill - Probe And Record Decisions

1. `agentic grill "<the request>"`.
2. Probes marked ASSUMED DEFAULT are open questions, not decisions. Put the real options to
   the user with their trade-offs.
3. Save the answers to `answers.json` keyed by probe id.
4. `agentic grill "<the request>" --answers answers.json` ratifies the ADR (PROPOSED -> ACCEPTED).
5. Deliver with `agentic prompt "<the request>" --answers answers.json`.
