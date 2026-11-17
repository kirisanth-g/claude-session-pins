# session-pins

A Claude Code mod that adds a **Pinned** pane beside the chat. The pane lists the Jira tickets and GitHub pull requests that the session works on. Each row links to the ticket or PR and shows its title and last-seen status.

## Set it up

The mod detects nothing from your tracker until you tell it where your work lives. Run this once:

```
/pins set jira=https://example.atlassian.net prefix=ABC,XYZ org=acme
```

- `jira` is your Jira site. Ticket pins link to it.
- `prefix` lists the project keys to detect in text.
- `org` is the GitHub owner that a bare `repo#12` belongs to.

The settings apply to later sessions too. An empty value clears a setting, for example `/pins set org=`. `/pins set` alone shows the settings.

## What it detects

- **Tickets** (`ABC-123`, for each project key in `prefix`):
  - Ticket keys in your prompts.
  - Ticket keys in `Skill` arguments, for example `/ticket-start ABC-123`.
  - Ticket keys in the Bash commands `wt new`, `git checkout`/`switch`/`commit` and `gh pr create`/`edit`.
  - Atlassian MCP calls on one issue (get, edit, transition, comment, worklog, create). These also give the title and status, and they work for any project key.
- **Pull requests**:
  - PR URLs in your prompts.
  - `gh pr view|checks|merge|edit|ready|comment|review|diff|close|reopen|update-branch`. The mod resolves each PR through `gh pr view --json` and honours `--repo` and a leading `cd <dir> &&`.
  - The URL that `gh pr create` prints.

The mod does not scan general tool output, so `git log` and search results do not add pins.

## Commands

- `/pin ABC-123 owner/repo#12 https://github.com/o/r/pull/9` adds pins by hand. A bare `repo#12` resolves to the `org` setting.
- `/unpin <ref>` hides a pin. The **x** button on a row does the same.
- `/pins` shows the pins again.
- `/pins band` moves the pins to a band above the prompt box. `/pins pane` moves them back to the pane. The **Move above prompt** and **Move to pane** buttons do the same. The choice applies to later sessions too.

The **Refresh PR status** button runs `gh pr view` again for each PR that is shown.

## Install

At the prompt of a terminal session:

```
/plugin install session-pins --marketplace kirisanth-g/claude-session-pins
```

From a shell:

```
claude plugin install session-pins --marketplace kirisanth-g/claude-session-pins
```

## Limits

- The pins belong to one session. They stay through reloads and compaction, but a new session starts empty.
- A status is the value last seen in the session. It is not a live value.
- Only Jira is supported as a ticket tracker.

## Development

```
claude plugin validate .
claude plugin test .
```

## License

MIT
