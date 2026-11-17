export type PinKind = 'ticket' | 'pr'

export type Pin = {
  kind: PinKind
  /** `ABC-123` for a ticket, `owner/repo#12` for a PR. */
  ref: string
  /** Absent for a ticket until the Jira site is set. */
  url?: string
  title?: string
  status?: string
  isHidden: boolean
}

/** What the person sets with `/pins set`. Nothing is detected or linked without it. */
export type Settings = {
  /** The Jira site, for example `https://example.atlassian.net`. */
  jira?: string
  /** The project keys to detect in text, for example `['ABC']`. */
  prefixes: string[]
  /** The GitHub owner a bare `repo#12` belongs to. */
  org?: string
}

/** Where the pins show: a pane, or a band above the prompt box. */
export type Placement = 'pane' | 'band'

declare module 'claude-code' {
  interface PluginState {
    'session-pins': { pins: Shaped<Pin[]>; placement: Placement; settings: Settings }
  }
}
