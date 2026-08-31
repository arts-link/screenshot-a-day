# Contributing

Thank you for improving Screenshot-a-Day.

Source development uses Node 24 LTS. After reviewing `.mise.toml`, select the repository
runtime with `mise trust`, `mise install`, `mise exec -- corepack enable`, and
`mise exec -- zsh`, or with `nvm install`, `nvm use`, and `corepack enable`; see the
[development guide](docs/development.md) for native dependency recovery.

1. Open or comment on an issue before making a broad architectural change.
2. Create a focused branch and use Conventional Commit messages.
3. Add or update tests and documentation in the same change.
4. Add a Changeset for user-visible changes: `pnpm changeset`.
5. Run `pnpm check` and `pnpm build` before requesting review.

## Developer Certificate of Origin

Every commit must certify the [Developer Certificate of Origin 1.1](DCO). Add the certification using Git's sign-off flag:

```sh
git commit --signoff -m "feat: describe the change"
```

This adds a `Signed-off-by: Name <email>` trailer using your configured Git identity. Review it with `git show --show-signature --format=full` before pushing. Sign-off records are public and retained with the project history. If a commit is missing the trailer, amend it with `git commit --amend --signoff` and update your branch without rewriting any released tag.

The repository uses the DCO GitHub App to check each pull request. It does not require or accept a Contributor License Agreement.

Architectural reversals require a new ADR. Never include real target credentials, browser traces, screenshots from private systems, or installation secrets in issues and tests.
