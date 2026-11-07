# dsh-allinstar

Star the GitHub repositories behind your installed DSH plugins, without leaving DeepSeek Harness.

Every installed plugin that declares a GitHub home gets a row and a star button. A star is public — it shows on the user's GitHub profile — so the first one asks for confirmation, and the answer is remembered.

## What it does

- **Reads your profile, not a catalog.** It walks the profile's `package.json` dependencies, reads each installed package's `repository` field, and normalises the many shapes a manifest uses (`git+https`, `ssh`, `github:owner/repo`, a bare `owner/repo`, a deep URL) into one `owner/repo`.
- **Adds a tab** beside *Installed* on the Plugins page, listing every plugin with a GitHub home, plus the ones without one, kept separate rather than hidden.
- **Adds a star control** to a plugin's own detail page.
- **Reads star state** with `GET /user/starred/{owner}/{repo}` and toggles it with `PUT` / `DELETE`, so it can unstar and never double-stars.
- **Works on any repository**, not only DSH plugins, through the agent tool.
- **Exposes a tool** `github_stars` (`list` / `star` / `unstar`, with `all`) so the model and the panel call the same Host methods.

## GitHub token

Starring needs an account. The token is resolved per call, most explicit first:

1. `DSH_GITHUB_TOKEN` in the environment
2. a token saved in the panel — stored as a credential record, never written into the profile's YAML
3. an already-authenticated `gh` CLI

Browsing works without any token; only starring requires one. A token is verified with `GET /user` before it is stored, so a rejected token cannot look saved.

Recommended: a **classic** personal access token with the `public_repo` scope. Fine-grained tokens are a poor fit here — as of writing, GitHub does not let them write to public repositories owned by users the token holder is not a member of, which is most of the plugins you would want to star.

## Install

```sh
dsh plugin add github:<owner>/dsh-allinstar
```

## Configuration

None. There is no config schema and nothing to set in the profile.

## Privacy and network

- Talks only to `api.github.com` over HTTPS.
- Sends the token as a bearer credential to that host and nowhere else.
- Reads only the local profile directory; it never uploads your plugin list.

## Requirements

- DSH with the Web UI.
- Node 20 or newer.

## License

MIT
