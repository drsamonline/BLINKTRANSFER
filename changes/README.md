# changes/

One small file per change, written WITH the change, in the same commit
that makes it. The consumer in the refresh reads the pending files,
bumps VERSION, prepends a dated section to CHANGELOG.md and deletes the
consumed files.

Each file holds:

```
---
bump: patch | minor | major
---

What changed, in one line a buyer would understand.
```

`patch` is a fix, `minor` is a feature, `major` is a breaking change.
If `changes/` is empty, the changelog does not change - so there are no
empty releases.
