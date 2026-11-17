# AGENTS.md

## What this repo is

session-pins is a Claude Code mod. It adds a **Pinned** pane (or a band above the prompt box) that lists the Jira tickets and GitHub pull requests a session works on.

Read `README.md` for what it detects and for its commands.

## Layout

```
.claude-plugin/plugin.json        the plugin: name, version, license, the types file
.claude-plugin/marketplace.json   lets the repo be installed as a marketplace
hooks/hooks.json                  names the hooks module
hooks/register.tsx                the hooks, the commands and the two UIs
hooks/detect.ts                   pure detection and parsing; no engine handle
types/index.d.ts                  the Pin, Settings and Placement types, and the state shape
tests/pins.test.tsx               the tests
```

## Check a change

```sh
claude plugin validate .   # must pass; warnings are acceptable
claude plugin test .       # every test must pass
```

Run both before each commit.

## How the code is split

- **`detect.ts` is pure.** It takes text and settings and returns values. It does not use the engine handle (`$`), so the tests call it directly. Put new parsing here.
- **`register.tsx` holds everything that needs `$`**: the hooks, the commands, the stored state and the UI.
- **State lives in atoms.** `pins` belongs to the session. `placement` and `settings` are also kept in `$.store`, so they apply to later sessions.

## Things that go wrong

- **`types/index.d.ts` must stand alone.** It cannot import or re-export from another file. The validator rejects it. Declare a shared type there, and import it from `../types` in the code.
- **Change the shape tag when `Pin` changes.** The `shape` option on the `pins` atom (`pins-2`) declines what an older version stored.
- **A test must answer the events it sends.** A test that calls `$.prompt.submit` needs `on('prompt.submit', (_, e) => ({ text: e.text }))`. A test that stores settings needs `mock.store(on)`.
- **A UI node keeps its props under `props`.** Read a link's address with `node.props.href`.
- **Nothing is detected without settings.** The Jira site, the project keys and the GitHub owner come from `/pins set`. With no project key, the mod finds no ticket in text. Keep it that way: do not add a default.
- **Detection reads only the commands that name the work** (`wt new`, `git checkout`, `gh pr create`, and the like). Do not scan general tool output: a `git log` must not add pins.

## Rules for this repo

- **The repo is public.** Do not commit a company name, a tracker address, a real ticket key, a real repo name or a person's work email. Tests and docs use made-up values (`ABC-123`, `example.atlassian.net`, `acme/web-api`). Run a search for such details before each commit.
- **Comments and docs use Simplified Technical English, main point first.** One idea in each sentence. Active voice, present tense. A comment says why, not what, and describes the code as it is now.
- **Commits use Conventional Commits**, with the GitHub noreply address that this clone is set to.
- **A release** changes `version` in `.claude-plugin/plugin.json` and gets an annotated tag (`git tag -a vX.Y.Z -m "session-pins X.Y.Z"`).
- **Do not add features, options or error handling that the task does not need.**
