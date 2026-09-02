# /agentic-verify - Close With Evidence

1. `agentic status` - see what is still awaiting a report.
2. `agentic report <TASK-ID> --status completed --commit <sha>` for anything finished.
3. `agentic verify` - runs the real suite, verifies each acceptance criterion, writes the
   as-built spec and updates the requirement matrix.

`COMPLETE` closes the cycle; `FAIL`/`REMEDIATING` needs a fix; `BLOCKED` means closure was
refused - report that plainly.
