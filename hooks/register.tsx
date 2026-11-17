import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pin, Placement, Settings } from '../types'
import {
  NO_SETTINGS,
  isJiraKey,
  isSettings,
  jiraFields,
  parseRef,
  prLookupsInCommand,
  prRef,
  prUrl,
  prUrlsIn,
  readSettings,
  ticketUrl,
  ticketsIn,
  ticketsInCommand,
} from './detect'
import type { PrLookup } from './detect'

const PANE = 'session-pins'
const TITLE = 'Pinned'
// Change the tag when Pin's fields change: it declines what an earlier version stored.
const pins = atom({ plugin: 'session-pins', key: 'pins' } as const, [], { shape: 'pins-2' })
// The session's copy redraws on change; `$.store` keeps the choice for later sessions.
const placement = atom({ plugin: 'session-pins', key: 'placement' } as const, 'pane')
const PLACEMENT_KEY = 'placement'
// The Jira site, the project keys and the GitHub owner. `$.store` keeps them for later sessions.
const settings = atom({ plugin: 'session-pins', key: 'settings' } as const, NO_SETTINGS)
const SETTINGS_KEY = 'settings'

function describe(now: Settings): string {
  return [
    `jira=${now.jira ?? '(not set)'}`,
    `prefix=${now.prefixes.join(',') || '(not set)'}`,
    `org=${now.org ?? '(not set)'}`,
  ].join(' ')
}

const isPlacement = (value: unknown): value is Placement => value === 'pane' || value === 'band'

/** Shows the pins where the person chose: opens the pane, or closes it for the band. */
async function seat($: EngineInterface, where: Placement): Promise<void> {
  if (where === 'pane') await $.ui.open({ id: PANE, title: TITLE })
  else await $.ui.close({ id: PANE })
}

/** Moves the pins and keeps the choice for later sessions. */
async function move($: EngineInterface, where: Placement): Promise<void> {
  await update($, placement, () => where)
  await $.store.set(PLACEMENT_KEY, where)
  await seat($, where)
}

/** The Jira tools whose call means the ticket is being worked on. */
const JIRA_TOOLS = /(getJiraIssue|editJiraIssue|transitionJiraIssue|addCommentToJiraIssue|addWorklogToJiraIssue|createJiraIssue)$/

type Found = Omit<Pin, 'isHidden'>

/** Adds or refreshes pins. A hidden pin stays hidden unless `show` is set. */
async function remember($: EngineInterface, found: Found[], show = false): Promise<void> {
  if (found.length === 0) return
  await update($, pins, list => {
    const next = [...list]
    for (const one of found) {
      const at = next.findIndex(p => p.ref === one.ref)
      const old = at >= 0 ? next[at] : undefined
      const merged: Pin = { ...old, ...one, isHidden: show ? false : (old?.isHidden ?? false) }
      if (old?.title && !one.title) merged.title = old.title
      if (old?.status && !one.status) merged.status = old.status
      if (at >= 0) next[at] = merged
      else next.push(merged)
    }
    return next
  })
}

function ticket(key: string, now: Settings): Found {
  const url = ticketUrl(key, now.jira)
  return { kind: 'ticket', ref: key, ...(url ? { url } : {}) }
}
const pr = (repo: string, number: number): Found => ({
  kind: 'pr',
  ref: prRef(repo, number),
  url: prUrl(repo, number),
})

/** Resolves a PR through `gh`, which gives its canonical repo, title and state. */
async function lookUpPr($: EngineInterface, lookup: PrLookup): Promise<Found | undefined> {
  const argv = ['gh', 'pr', 'view']
  if (lookup.selector) argv.push(lookup.selector)
  if (lookup.repo) argv.push('--repo', lookup.repo)
  argv.push('--json', 'number,url,title,state,isDraft')
  try {
    const ran = await $.process.run(argv, { ...(lookup.cwd ? { cwd: lookup.cwd } : {}), timeoutMs: 15_000 })
    if (ran.exitCode !== 0) return undefined
    const data = JSON.parse(ran.stdout) as {
      url?: string
      title?: string
      state?: string
      isDraft?: boolean
    }
    const where = data.url ? prUrlsIn(data.url)[0] : undefined
    if (!where) return undefined
    const found = pr(where.repo, where.number)
    if (data.title) found.title = data.title
    const status = data.isDraft && data.state === 'OPEN' ? 'DRAFT' : data.state
    if (status) found.status = status
    return found
  } catch {
    return undefined
  }
}

async function resolvePrs($: EngineInterface, lookups: PrLookup[], show = false): Promise<void> {
  const found = await Promise.all(lookups.map(one => lookUpPr($, one)))
  await remember($, found.filter((one): one is Found => one !== undefined), show)
}

async function refreshAll($: EngineInterface): Promise<void> {
  const list = await read($, pins)
  await resolvePrs(
    $,
    list.filter(p => p.kind === 'pr' && !p.isHidden).map(p => ({ selector: p.url })),
  )
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'pin',
      description: 'Pin a ticket or PR: ABC-123, a PR URL, or owner/repo#12',
      argumentHint: '<ref> [ref...]',
    })
    await $.command.register({
      name: 'unpin',
      description: 'Remove a ticket or PR from the pinned pane',
      argumentHint: '<ref> [ref...]',
    })
    await $.command.register({
      name: 'pins',
      description: 'Show the pinned tickets and PRs; "band" or "pane" moves them; "set" stores the Jira site, project keys and GitHub owner',
      argumentHint: '[pane|band|set jira=<url> prefix=<KEY,...> org=<owner>]',
    })
    const stored = await $.store.get(PLACEMENT_KEY)
    const where = isPlacement(stored) ? stored : 'pane'
    await update($, placement, () => where)
    const kept = await $.store.get(SETTINGS_KEY)
    if (isSettings(kept)) await update($, settings, () => kept)
    void seat($, where)
    return started
  })

  on('command.run', { command: 'pins' }, async ($, e) => {
    if (/^set(\s|$)/i.test(e.args.trim())) {
      const parsed = readSettings(e.args.trim().slice(3), await read($, settings))
      await update($, settings, () => parsed.settings)
      await $.store.set(SETTINGS_KEY, parsed.settings)
      const rejected = parsed.unknown.length ? ` Not recognised: ${parsed.unknown.join(', ')}` : ''
      return { text: `${describe(parsed.settings)}${rejected}` }
    }
    const arg = e.args.trim().toLowerCase()
    if (arg && !isPlacement(arg)) return { text: `Unknown option "${arg}". Use /pins pane or /pins band.` }
    const where = isPlacement(arg) ? arg : await read($, placement)
    if (arg) await move($, where)
    else await seat($, where)
    return { text: where === 'band' ? 'Pins show above the prompt box.' : 'Pinned pane opened.' }
  })

  on('command.run', { command: 'pin' }, async ($, e) => {
    const refs = e.args.split(/[\s,]+/).filter(Boolean)
    const tickets: Found[] = []
    const lookups: PrLookup[] = []
    const unknown: string[] = []
    const now = await read($, settings)
    for (const arg of refs) {
      const ref = parseRef(arg, now.org)
      if (ref?.kind === 'ticket') tickets.push(ticket(ref.key, now))
      else if (ref?.kind === 'pr') lookups.push({ selector: prUrl(ref.repo, ref.number) })
      else unknown.push(arg)
    }
    await remember($, tickets, true)
    // Pin the PR at once, then let `gh` fill in its title and state.
    await remember(
      $,
      lookups.flatMap(l => prUrlsIn(l.selector ?? '')).map(p => pr(p.repo, p.number)),
      true,
    )
    void resolvePrs($, lookups, true)
    await seat($, await read($, placement))
    const done = refs.length - unknown.length
    return {
      text: unknown.length
        ? `Pinned ${done}. Not recognised: ${unknown.join(', ')}`
        : `Pinned ${done}.`,
    }
  })

  on('command.run', { command: 'unpin' }, async ($, e) => {
    const { org } = await read($, settings)
    const refs = e.args
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(arg => {
        const ref = parseRef(arg, org)
        if (ref?.kind === 'ticket') return ref.key
        if (ref?.kind === 'pr') return prRef(ref.repo, ref.number)
        return arg
      })
    await update($, pins, list =>
      list.map(p => (refs.includes(p.ref) ? { ...p, isHidden: true } : p)),
    )
    return { text: `Unpinned ${refs.join(', ')}.` }
  })

  on('prompt.submit', async ($, e, next) => {
    const now = await read($, settings)
    await remember($, [
      ...ticketsIn(e.text, now.prefixes).map(key => ticket(key, now)),
      ...prUrlsIn(e.text).map(p => pr(p.repo, p.number)),
    ])
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    const output = ran.text ?? ''
    const now = await read($, settings)

    if (e.tool === 'Bash') {
      const command = e.command
      const found: Found[] = ticketsInCommand(command, now.prefixes).map(key => ticket(key, now))
      if (/\bgh\s+pr\s+create\b/.test(command)) {
        found.push(...prUrlsIn(output).map(p => pr(p.repo, p.number)))
      }
      const lookups = prLookupsInCommand(command)
      for (const l of lookups) {
        if (l.repo && l.selector && /^\d+$/.test(l.selector)) found.push(pr(l.repo, Number(l.selector)))
        found.push(...prUrlsIn(l.selector ?? '').map(p => pr(p.repo, p.number)))
      }
      await remember($, found)
      for (const p of prUrlsIn(output).filter(() => /\bgh\s+pr\s+create\b/.test(command))) {
        lookups.push({ selector: prUrl(p.repo, p.number) })
      }
      if (lookups.length) void resolvePrs($, lookups)
    } else if (e.tool === 'Skill') {
      await remember($, ticketsIn(asText(e.args), now.prefixes).map(key => ticket(key, now)))
    } else if (e.tool.startsWith('mcp__') && JIRA_TOOLS.test(e.tool)) {
      const fields = jiraFields(output)
      const loose = e as Record<string, unknown>
      const key = fields.key ?? (isJiraKey(loose['issueIdOrKey']) ? loose['issueIdOrKey'] : undefined)
      if (key) {
        const found = ticket(key, now)
        if (fields.title) found.title = fields.title
        if (fields.status) found.status = fields.status
        await remember($, [found])
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, placement)) !== 'band') return next(e)
    const shown = (await read($, pins)).filter(p => !p.isHidden)
    const { Box, Text, Button, Link } = $.ui.resolve(e)

    const chip = (p: Pin) => (
      <Box flexDirection="row" gap={1}>
        {p.url ? (
          <Link href={p.url} label={p.kind === 'pr' ? (p.ref.split('/')[1] ?? p.ref) : p.ref} />
        ) : (
          <Text>{p.ref}</Text>
        )}
        {p.status ? <Text color="cyan">{p.status}</Text> : null}
        <Button
          key={`hide:${p.ref}`}
          label="x"
          onPress={() =>
            update($, pins, list => list.map(q => (q.ref === p.ref ? { ...q, isHidden: true } : q)))
          }
        />
      </Box>
    )

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text bold>Pinned</Text>
        {shown.length === 0 ? <Text dimColor>nothing yet</Text> : null}
        {shown.filter(p => p.kind === 'ticket').map(chip)}
        {shown.filter(p => p.kind === 'pr').map(chip)}
        <Button key="move" label="Move to pane" onPress={() => move($, 'pane')} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const shown = (await read($, pins)).filter(p => !p.isHidden)
    const tickets = shown.filter(p => p.kind === 'ticket')
    const prs = shown.filter(p => p.kind === 'pr')

    const row = (p: Pin) => (
      <Box flexDirection="row" gap={1}>
        {p.url ? (
          <Link href={p.url} label={p.kind === 'pr' ? (p.ref.split('/')[1] ?? p.ref) : p.ref} />
        ) : (
          <Text>{p.ref}</Text>
        )}
        {p.status ? <Text color="cyan">{p.status}</Text> : null}
        {p.title ? <Text dimColor>{p.title}</Text> : null}
        <Button
          key={`hide:${p.ref}`}
          label="x"
          onPress={() =>
            update($, pins, list => list.map(q => (q.ref === p.ref ? { ...q, isHidden: true } : q)))
          }
        />
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {shown.length === 0 ? (
          <Text dimColor>Nothing pinned yet. Tickets and PRs this session touches show here, or use /pin ABC-123.</Text>
        ) : null}
        {tickets.length > 0 ? (
          <Box flexDirection="column">
            <Text bold>Tickets</Text>
            {tickets.map(row)}
          </Box>
        ) : null}
        {prs.length > 0 ? (
          <Box flexDirection="column">
            <Text bold>Pull requests</Text>
            {prs.map(row)}
          </Box>
        ) : null}
        <Box flexDirection="row" gap={2}>
          {prs.length > 0 ? (
            <Button key="refresh" label="Refresh PR status" onPress={() => refreshAll($)} />
          ) : null}
          <Button key="move" label="Move above prompt" onPress={() => move($, 'band')} />
        </Box>
      </Box>
    )
  })
}
