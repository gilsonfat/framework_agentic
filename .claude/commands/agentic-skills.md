# /agentic-skills - Shared Techniques Per Stage

```bash
agentic skills                              # packs configured, and what is installed here
agentic skills stage implement --installed  # what to use while implementing
agentic skills stage review                 # what the team uses to review
agentic skills install mattpocock           # print the install command (--run to execute)
```

The mapping lives in `.agentic/orchestrator/skills.yaml`. Use the mapped skill for the
stage you are in rather than improvising, and tell the user when a mapped skill is
missing on this machine instead of silently diverging from the team standard.

Never let a skill substitute for the framework's guarantees: identifiers come from the
registry and closure comes from `agentic verify`.
