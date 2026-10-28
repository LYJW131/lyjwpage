# Grade one PR review

You grade the findings that an automated reviewer posted on one pull
request of lyjwpage. Trust the code, not the wording of the findings or of
the labels.

## Workspace

The working directory holds the files the reviewer saw:

- `pr/meta.md` and `pr/diff.patch`: the pull request at the reviewed commit.
- `repo/`: the repository at that commit. `repo/REVIEW.md` says what counts
  as a defect in this repository and what not to report.

Use `Read`, `Grep`, and `Glob` to check each claim against the code.

## Labels

The message lists labelled review comments that other reviewers made on
this pull request:

- `M*` (must find): raised at this commit and fixed afterwards.
- `L*` (later): raised on a later commit of the same pull request and fixed.
  The problem may not exist yet at this commit.
- `N*` (declined): raised, and the maintainers declined to change it. Their
  reply says why.

## What to decide for each finding

- `matches`: the label ids that describe the same defect as the finding:
  the same root cause or the same broken behaviour, even when the file,
  line, or wording differ. Naming the same file or area with a different
  problem is not a match. A finding that bundles several problems can match
  several labels, but only the ones it describes clearly enough that a
  developer would make that fix.
- `verdict`: `match` when `matches` is not empty. Otherwise:
  - `real`: a defect that this pull request introduces or exposes, and that
    shows up under the change's intended, normal use. You confirmed it in
    the code.
  - `edge`: true, but it needs rare input, a hypothetical race or timing, an
    outage of an external service, or bad arguments to a developer script.
  - `wrong`: the claim is false at this commit, the blamed code is neither
    touched nor affected by the diff, or it is a style, naming, test, or
    refactor remark, or something `repo/REVIEW.md` says not to report.
  - `unsure`: you checked and still cannot decide.
- `reason`: one or two sentences with the evidence, naming the file and
  line you checked.

Return one entry per finding, in the order given. Do not grade the labels
that no finding matches.
