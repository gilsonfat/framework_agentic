# /agentic-team - Team Coordination

```bash
agentic team who                      # identity and every active claim
agentic team claim <PHASE|TASK>       # claim work so teammates do not collide
agentic team release <PHASE|TASK>     # release it when done
agentic team init                     # (re)declare the shared/local artifact split
```

Before starting work on a phase, check `agentic team who`. If a teammate holds it, coordinate
instead of forcing: `--force` takes over a lease and is recorded in the audit stream.
