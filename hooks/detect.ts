// Pure detection: no `$`, so the tests call it directly.

import type { Settings } from '../types'

export const NO_SETTINGS: Settings = { prefixes: [] }

const PROJECT_KEY = /^[A-Z][A-Z0-9]+$/
const JIRA_KEY = /^[A-Z][A-Z0-9]+-\d+$/
const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g
const PR_SHORT = /^(?:([\w.-]+)\/)?([\w.-]+)#(\d+)$/

/** The commands whose text names the ticket being worked on. */
const TICKET_COMMAND = /\b(wt\s+new|git\s+(checkout|switch|commit)|gh\s+pr\s+(create|edit))\b/

/** The `gh pr` subcommands that act on one PR. */
const PR_SUBCOMMANDS = new Set([
  'create', 'view', 'checks', 'merge', 'edit', 'ready', 'comment',
  'review', 'diff', 'close', 'reopen', 'update-branch',
])

/** The `gh pr` flags that take a value, so their value is not a PR selector. */
const VALUE_FLAGS = new Set([
  '-R', '--repo', '--json', '-q', '--jq', '-t', '--template', '--title',
  '-b', '--body', '-F', '--body-file', '-B', '--base', '-H', '--head',
  '-L', '--limit', '-l', '--label', '-r', '--reviewer', '-a', '--assignee',
  '-m', '--milestone', '-p', '--project', '--add-label', '--remove-label',
  '--add-reviewer', '--remove-reviewer', '--add-assignee', '--remove-assignee',
  '--subject', '--match-head-commit', '--author-email', '--interval',
])

export type PrLookup = { selector?: string; repo?: string; cwd?: string }

export const ticketUrl = (key: string, jira: string | undefined) =>
  jira ? `${jira}/browse/${key}` : undefined

/** The keys of the configured projects that the text names. */
export function ticketsIn(text: string, prefixes: string[]): string[] {
  const keys = prefixes.filter(p => PROJECT_KEY.test(p))
  if (keys.length === 0) return []
  const pattern = new RegExp(`\\b(?:${keys.join('|')})-\\d+\\b`, 'gi')
  return unique([...text.matchAll(pattern)].map(m => m[0].toUpperCase()))
}

/** Reads `/pins set jira=<url> prefix=ABC,DEF org=<owner>`. An empty value clears a setting. */
export function readSettings(args: string, current: Settings): { settings: Settings; unknown: string[] } {
  const settings: Settings = { ...current, prefixes: [...current.prefixes] }
  const unknown: string[] = []
  for (const word of args.split(/\s+/).filter(Boolean)) {
    const at = word.indexOf('=')
    const name = at < 0 ? '' : word.slice(0, at).toLowerCase()
    const value = at < 0 ? '' : word.slice(at + 1)
    if (name === 'jira' && (value === '' || /^https:\/\/[\w.-]+(\/[\w./-]*)?$/.test(value))) {
      if (value) settings.jira = value.replace(/\/+$/, '')
      else delete settings.jira
    } else if (name === 'prefix' && value.split(',').filter(Boolean).every(p => PROJECT_KEY.test(p.toUpperCase()))) {
      settings.prefixes = unique(value.split(',').filter(Boolean).map(p => p.toUpperCase()))
    } else if (name === 'org' && (value === '' || /^[\w.-]+$/.test(value))) {
      if (value) settings.org = value
      else delete settings.org
    } else {
      unknown.push(word)
    }
  }
  return { settings, unknown }
}

export function isSettings(value: unknown): value is Settings {
  const record = asRecord(value)
  if (!record) return false
  const { jira, prefixes, org } = record
  return (
    (jira === undefined || typeof jira === 'string') &&
    (org === undefined || typeof org === 'string') &&
    Array.isArray(prefixes) &&
    prefixes.every(p => typeof p === 'string')
  )
}

export function prUrlsIn(text: string): { repo: string; number: number }[] {
  return [...text.matchAll(PR_URL)].map(m => ({ repo: m[1] ?? '', number: Number(m[2]) }))
}

export const prRef = (repo: string, number: number) => `${repo}#${number}`
export const prUrl = (repo: string, number: number) => `https://github.com/${repo}/pull/${number}`

/** Reads what `/pin` was given: a ticket key, a PR URL, `owner/repo#12`, or `repo#12` when an org is set. */
export function parseRef(
  arg: string,
  org?: string,
): { kind: 'ticket'; key: string } | { kind: 'pr'; repo: string; number: number } | undefined {
  const text = arg.trim()
  const browse = /\/browse\/([A-Z][A-Z0-9]+-\d+)/.exec(text)
  if (browse?.[1]) return { kind: 'ticket', key: browse[1] }
  if (JIRA_KEY.test(text.toUpperCase())) return { kind: 'ticket', key: text.toUpperCase() }
  const url = prUrlsIn(text)[0]
  if (url) return { kind: 'pr', ...url }
  const short = PR_SHORT.exec(text)
  const owner = short?.[1] ?? org
  if (owner && short?.[2] && short[3]) {
    return { kind: 'pr', repo: `${owner}/${short[2]}`, number: Number(short[3]) }
  }
  return undefined
}

export function isJiraKey(value: unknown): value is string {
  return typeof value === 'string' && JIRA_KEY.test(value)
}

/** The tickets a Bash command works on: only commands that name the current work. */
export function ticketsInCommand(command: string, prefixes: string[]): string[] {
  return TICKET_COMMAND.test(command) ? ticketsIn(command, prefixes) : []
}

/** The PRs a Bash command acts on, as `gh pr view` arguments to resolve. */
export function prLookupsInCommand(command: string): PrLookup[] {
  const lookups: PrLookup[] = []
  let cwd: string | undefined
  for (const segment of segments(command)) {
    const words = tokenize(segment)
    if (words[0] === 'cd' && words[1]) cwd = words[1]
    const at = findSubsequence(words, ['gh', 'pr'])
    if (at < 0) continue
    const sub = words[at + 2]
    if (!sub || !PR_SUBCOMMANDS.has(sub)) continue
    const lookup: PrLookup = {}
    if (cwd) lookup.cwd = cwd
    const rest = words.slice(at + 3)
    for (let i = 0; i < rest.length; i++) {
      const word = rest[i] ?? ''
      if (word === '-R' || word === '--repo') {
        const repo = rest[i + 1]
        if (repo) lookup.repo = repo
        i++
      } else if (word.startsWith('--repo=')) {
        lookup.repo = word.slice('--repo='.length)
      } else if (VALUE_FLAGS.has(word)) {
        i++
      } else if (!word.startsWith('-') && lookup.selector === undefined && sub !== 'create') {
        lookup.selector = word
      }
    }
    // `create` is resolved from the URL it prints, not from a lookup.
    if (sub !== 'create') lookups.push(lookup)
  }
  return lookups
}

/** Pulls the summary and status out of a Jira tool result, JSON or not. */
export function jiraFields(text: string): { key?: string; title?: string; status?: string } {
  const out: { key?: string; title?: string; status?: string } = {}
  try {
    const parsed: unknown = JSON.parse(text)
    const issue = asRecord(parsed)
    const fields = asRecord(issue?.['fields'])
    const key = issue?.['key']
    const summary = fields?.['summary']
    const status = asRecord(fields?.['status'])?.['name']
    if (isJiraKey(key)) out.key = key
    if (typeof summary === 'string') out.title = summary
    if (typeof status === 'string') out.status = status
    return out
  } catch {
    const summary = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text)?.[1]
    const status = /"status"\s*:\s*\{[^}]*?"name"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text)?.[1]
    if (summary) out.title = summary
    if (status) out.status = status
    return out
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)]
}

function findSubsequence(words: string[], seq: string[]): number {
  for (let i = 0; i + seq.length <= words.length; i++) {
    if (seq.every((w, j) => words[i + j] === w)) return i
  }
  return -1
}

/** Splits a shell line on `;`, `&&`, `||`, `|` and newlines outside quotes. */
function segments(command: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | undefined
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] ?? ''
    if (quote) {
      if (ch === quote) quote = undefined
      current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
    } else if (ch === ';' || ch === '|' || ch === '&' || ch === '\n') {
      if (current.trim()) out.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) out.push(current)
  return out
}

/** Splits one shell segment into words, honouring single and double quotes. */
function tokenize(segment: string): string[] {
  const words: string[] = []
  let word = ''
  let hasWord = false
  let quote: string | undefined
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = undefined
      else word += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      hasWord = true
    } else if (/\s/.test(ch)) {
      if (hasWord || word) words.push(word)
      word = ''
      hasWord = false
    } else {
      word += ch
    }
  }
  if (hasWord || word) words.push(word)
  return words
}
