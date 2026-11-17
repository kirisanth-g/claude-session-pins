import { expect, mock, test } from 'claude-code/testing'

import { NO_SETTINGS, parseRef, prLookupsInCommand, readSettings, ticketsIn, ticketsInCommand } from '../hooks/detect'

const PANE = {
  plugin: 'session-pins',
  component: 'Pane',
  requestId: 'session-pins',
  props: {
    title: 'Pinned',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const GH_VIEW = JSON.stringify({
  number: 1560,
  url: 'https://github.com/acme/web-api/pull/1560',
  title: 'feat(ABC-3216): list order options',
  state: 'OPEN',
  isDraft: false,
})

test('detection reads only commands that name the work', () => {
  expect(ticketsInCommand('wt new ABC-3216 --no-code', ['ABC'])).toEqual(['ABC-3216'])
  expect(ticketsInCommand('git log --oneline | grep ABC-1', ['ABC'])).toEqual([])
  expect(ticketsInCommand('wt new ABC-3216 --no-code', [])).toEqual([])
  expect(ticketsIn('abc-7 and XYZ-8 and UTF-8', ['ABC', 'XYZ'])).toEqual(['ABC-7', 'XYZ-8'])
  expect(prLookupsInCommand('gh pr checks 1560 --repo acme/web-api')).toEqual([
    { selector: '1560', repo: 'acme/web-api' },
  ])
  expect(prLookupsInCommand('cd ~/dev/web-app && gh pr view --json title')).toEqual([
    { cwd: '~/dev/web-app' },
  ])
  expect(prLookupsInCommand('gh pr list --state open')).toEqual([])
  expect(parseRef('web-app#12', 'acme')).toEqual({ kind: 'pr', repo: 'acme/web-app', number: 12 })
  expect(parseRef('web-app#12')).toBeUndefined()
  expect(parseRef('other/web-app#12', 'acme')).toEqual({ kind: 'pr', repo: 'other/web-app', number: 12 })
  expect(parseRef('abc-9')).toEqual({ kind: 'ticket', key: 'ABC-9' })
})

test('/pins set reads, replaces and clears the settings', () => {
  const first = readSettings('jira=https://example.atlassian.net/ prefix=abc,XYZ org=acme colour=red', NO_SETTINGS)
  expect(first.settings).toEqual({ jira: 'https://example.atlassian.net', prefixes: ['ABC', 'XYZ'], org: 'acme' })
  expect(first.unknown).toEqual(['colour=red'])
  const second = readSettings('org= jira=http://plain.example', first.settings)
  expect(second.settings).toEqual({ jira: 'https://example.atlassian.net', prefixes: ['ABC', 'XYZ'] })
  expect(second.unknown).toEqual(['jira=http://plain.example'])
})

test('a prompt pins a ticket only for a configured project key', async ($, on) => {
  on('command.register', () => ({ value: { command: 'pins' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  mock.store(on)
  const origin = { kind: 'composer' } as const
  const presentation = { isFullscreen: false, columns: 80 }

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.prompt.submit({ text: 'work on ABC-5' })
  const before = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await before.find({ key: 'hide:ABC-5' })).toBeUndefined()
  await before.unmount()

  const ran = await $.command.run({
    command: 'pins',
    args: 'set jira=https://example.atlassian.net prefix=ABC',
    origin,
    presentation,
  })
  expect(ran.text).toBe('jira=https://example.atlassian.net prefix=ABC org=(not set)')
  await $.prompt.submit({ text: 'work on ABC-5 and XYZ-6' })

  const after = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await after.find({ key: 'hide:ABC-5' })).toBeDefined()
  expect(await after.find({ key: 'hide:XYZ-6' })).toBeUndefined()
  expect((await after.find({ type: 'Link' }))?.props.href).toBe('https://example.atlassian.net/browse/ABC-5')
  await after.unmount()
})

test('the pane shows tickets and PRs the session touches, on every surface', async ($, on) => {
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'pin' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: GH_VIEW, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', (_, e) =>
    e.tool === 'mcp__claude_ai_Atlassian__getJiraIssue'
      ? {
          result: {},
          text: JSON.stringify({
            key: 'ABC-3216',
            fields: { summary: 'List orders', status: { name: 'In Progress' } },
          }),
        }
      : { result: {}, text: '' },
  )

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__claude_ai_Atlassian__getJiraIssue',
    issueIdOrKey: 'ABC-3216',
  })
  await $.tool.call({ tool: 'Bash', command: 'gh pr checks 1560 --repo acme/web-api' })
  // The `gh` lookup runs after the tool call returns, so the model is not held.
  await clock.settle()

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /In Progress/ }))?.text).toBe('In Progress')
    expect((await ui.find({ type: 'Text', text: /list order options/ }))?.text).toBe(
      'feat(ABC-3216): list order options',
    )
    expect((await ui.find({ type: 'Text', text: /^OPEN$/ }))?.text).toBe('OPEN')
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'hide:ABC-3216' })
  expect(await ui.find({ type: 'Text', text: /In Progress/ })).toBeUndefined()
  await ui.unmount()
})

test('/pin adds a ticket by hand', async ($, on) => {
  on('command.register', () => ({ value: { command: 'pin' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  const ran = await $.command.run({
    command: 'pin',
    args: 'ABC-42 nonsense',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(ran.text).toBe('Pinned 1. Not recognised: nonsense')

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ key: 'hide:ABC-42' })).toBeDefined()
  await ui.unmount()
})

const BAND = {
  plugin: 'session-pins',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('/pins band moves the pins above the prompt box and remembers it', async ($, on) => {
  on('command.register', () => ({ value: { command: 'pins' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  mock.store(on)
  const origin = { kind: 'composer' } as const
  const presentation = { isFullscreen: false, columns: 80 }

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.command.run({ command: 'pin', args: 'ABC-42', origin, presentation })

  const before = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await before.find({ key: 'hide:ABC-42' })).toBeUndefined()
  await before.unmount()

  const ran = await $.command.run({ command: 'pins', args: 'band', origin, presentation })
  expect(ran.text).toBe('Pins show above the prompt box.')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'hide:ABC-42' })).toBeDefined()
    await ui.unmount()
  }

  const bad = await $.command.run({ command: 'pins', args: 'top', origin, presentation })
  expect(bad.text).toBe('Unknown option "top". Use /pins pane or /pins band.')
})

test('a stored band choice carries into a new session', async ($, on) => {
  on('command.register', () => ({ value: { command: 'pins' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.store(on, { placement: 'band' })

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.command.run({
    command: 'pin',
    args: 'ABC-7',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await ui.find({ key: 'hide:ABC-7' })).toBeDefined()
  await ui.unmount()
})

test('the move buttons switch between the pane and the band', async ($, on) => {
  on('command.register', () => ({ value: { command: 'pins' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  mock.store(on)

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await pane.press({ key: 'move' })
  await pane.unmount()

  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await band.find({ type: 'Text', text: /nothing yet/ }))?.text).toBe('nothing yet')
  await band.press({ key: 'move' })
  await band.unmount()

  const after = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await after.find({ type: 'Text' }))?.text).toBe('engine band')
  await after.unmount()
})
