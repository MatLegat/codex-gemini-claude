import { expect, mock, test } from 'claude-code/testing'

const CODEX = {
  thread: '01a18e91-1633-7ad0-a021-fc029a27049e',
  model: 'gpt-6-sol',
  effort: 'medium',
  tokens: 49_702,
  window: 258_400,
  percent: 19,
  updatedAt: 0,
}

const GEMINI = { conversation: 'b4e2528', tokens: 52_429, window: 1_048_576, percent: 5, updatedAt: 0 }

const GEMINI_USAGE = {
  windows: [
    { name: '5h', percent: 40, resetsAt: 120_000 + 3 * 3_600_000 },
    { name: 'Weekly', percent: 10, resetsAt: 120_000 + 6 * 86_400_000 },
  ],
}

const CODEX_USAGE = {
  windows: [
    { name: '5h', percent: 81, resetsAt: 120_000 + 2 * 3_600_000 },
    { name: 'Weekly', percent: 64, resetsAt: 120_000 + 4 * 86_400_000 + 3 * 3_600_000 },
  ],
  plan: 'plus',
  isLive: true,
}

// Every Text drawn, in order.
async function lines(ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }): Promise<string[]> {
  return (await ui.findAll({ type: 'Text' })).map(t => t.text)
}

// The heading and the Texts drawn after it: two windows of three columns by default.
async function block(ui: Parameters<typeof lines>[0], heading: string, count = 7): Promise<string[]> {
  const shown = await lines(ui)
  const at = shown.indexOf(heading)

  return at < 0 ? [] : shown.slice(at, at + count)
}

// One-glyph Texts in order (on the desktop, just the two indicators), each as glyph+color
// (`dim` for a dimmed one), with a trailing `*` when bold.
async function glyphs(ui: Parameters<typeof lines>[0]): Promise<string[]> {
  return (await ui.findAll({ type: 'Text' }))
    .filter(t => [...t.text].length === 1 && t.text !== '—')
    .map(t => {
      const { color, dimColor, bold } = (t as unknown as { props: { color?: string; dimColor?: boolean; bold?: boolean } }).props

      return `${t.text}${color ?? (dimColor ? 'dim' : '')}${bold ? '*' : ''}`
    })
}

// An image as `Claude 12%`: whose it is, by its color (none: an empty mark), and its alt, the percentage alone.
type SvgNode = { props: { alt: string; source: string } }
const svgLabel = (r: SvgNode) => {
  const who = r.props.source.includes('#D97757') ? 'Claude' : r.props.source.includes('#10A39F') ? 'Codex' : r.props.source.includes('#3487FF') ? 'Gemini' : 'empty'

  return `${who} ${r.props.alt}`
}

// The rings before the buttons, by what they say.
async function rowIcons(ui: Parameters<typeof lines>[0]): Promise<string[]> {
  return ((await (ui as unknown as { findAll: (q: { type: string }) => Promise<SvgNode[]> }).findAll({ type: 'Svg' }))).map(svgLabel)
}

// [Claude's indicator (Context row), Codex's indicator (Usage row)].
async function indicators(ui: Parameters<typeof lines>[0]): Promise<string[]> {
  const g = await glyphs(ui)

  return [g[0] ?? '', g[1] ?? '']
}

function runResult(stdout: string) {
  return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

const BAND = {
  plugin: 'codex-gemini-claude',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const PANE = {
  plugin: 'codex-gemini-claude',
  component: 'Pane',
  requestId: 'context-all',
  props: {
    title: 'Context',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('band and pane show Claude and Codex usage', { options: { layout: 'buttons' } }, async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'context-all' } }))
  mock.clock(on, { now: 120_000 })
  mock.store(on)
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      rateLimits: [
        { kind: 'five_hour', percentUsed: 12, resetsAt: new Date(120_000 + 90 * 60_000).toISOString() },
        { kind: 'seven_day', percentUsed: 30.5, resetsAt: new Date(120_000 + 2 * 86_400_000).toISOString() },
      ],
      context: { tokens: 253_800, window: 1_000_000, percent: 25 },
    },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'claude-session-1' }))
  on('env.get', () => ({ value: '/Users/test' }))
  const contextArgv: string[][] = []
  on('process.run', (_, e) => {
    if (e.argv[0] === 'date') {
      return runResult('-0300\n')
    }
    if (e.argv.some(a => a.includes('usage-codex'))) {
      return runResult(JSON.stringify(CODEX_USAGE))
    }
    contextArgv.push([...e.argv])

    return runResult(JSON.stringify(CODEX))
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(contextArgv[0]?.slice(-3)).toEqual(['--json', '--session', 'claude-session-1'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ key: 'claude' }))?.text).toBe('25%')
    // Rows get a line between them on the desktop, whose buttons are taller than a line.
    expect((await ui.find({ type: 'Box' }))?.props.rowGap).toBe(surface === 'desktop' ? 1 : 0)
    expect((await ui.find({ key: 'codex' }))?.text).toBe('19%')
    const glyphColors = (await ui.findAll({ type: 'Text', text: /^(✻|❂)$/ })).map(t => t.props.color ?? (t.props.dimColor ? 'dim' : ''))
    const rings = (await ui.findAll({ type: 'Svg' })) as unknown as SvgNode[]
    if (surface === 'terminal') {
      // No Svg in the terminal: the row icons stay glyphs.
      expect(glyphColors).toEqual(['#D97757', '#10A39F', '#5C5C5C', '#D97757', '#10A39F', '#5C5C5C'])
      expect(rings).toHaveLength(0)
    } else {
      // Each button gets a ring of its percentage in its model's color; only the indicators are glyphs.
      expect(glyphColors).toEqual(['#5C5C5C', '#5C5C5C'])
      expect(rings.map(svgLabel)).toEqual(['Claude 25%', 'Codex 19%', 'Claude 31%', 'Codex 81%'])
      // The alt text is the percentage alone, short enough for VS Code to show in the image's place.
      expect(rings.map(r => r.props.alt)).toEqual(['25%', '19%', '31%', '81%'])
      expect(rings.map(r => r.props.source.includes('stroke="#D97757"') ? 'claude' : r.props.source.includes('stroke="#10A39F"') ? 'codex' : ''))
        .toEqual(['claude', 'codex', 'claude', 'codex'])
      // Logos are off (RING_LOGO = false): the rings are empty.
      expect(rings.every(r => !r.props.source.includes('<path'))).toBe(true)
      // Hover lines are off (RING_HOVER = false): none are drawn.
      expect(await ui.find({ key: 'hover-claude-context' })).toBeUndefined()
    }
    expect(await ui.find({ type: 'Text', text: /253,800/ })).toBeUndefined()

    // Each button opens its own details.
    await ui.press({ key: 'claude' })
    expect(await block(ui, '✻ Claude context', 2)).toEqual(['✻ Claude context', 'claude-opus-5-5 · 253,800 / 1,000,000 tokens'])
    expect((await ui.find({ type: 'Text', text: '✻ Claude context' }))?.props.color).toBe('#D97757')
    expect(await lines(ui)).not.toContain('❂ Codex context')

    await ui.press({ key: 'codex' })
    expect(await block(ui, '❂ Codex context', 2)).toEqual(['❂ Codex context', 'gpt-6-sol, medium · 49,702 / 258,400 tokens'])
    expect(await ui.find({ type: 'Text', text: /thread/ })).toBeUndefined()

    await ui.press({ key: 'claude' })
    expect(await lines(ui)).not.toContain('✻ Claude context')
    expect(await lines(ui)).toContain('❂ Codex context')

    await ui.press({ key: 'codex' })

    // The usage row: its own two buttons.
    expect((await ui.find({ key: 'claude-usage' }))?.text).toBe('31%')
    expect((await ui.find({ key: 'codex-usage' }))?.text).toBe('81%')
    await ui.press({ key: 'codex-usage' })
    // Local time is UTC-3: under a day away shows the time, further away the date.
    // Each row is three Texts, one per fixed-width column.
    expect(await block(ui, '❂ Codex usage')).toEqual(['❂ Codex usage', '81%', '5h', '(resets 23h02)', '64%', 'weekly', '(resets Jan 5)'])
    expect(await lines(ui)).not.toContain('✻ Claude usage')
    const widths = (await ui.findAll({ type: 'Box' })).map(b => b.props.width).filter(w => w !== undefined)
    // Per row: label, Claude column, its icon slot, Codex's icon slot, the indicator column;
    // then the usage block's columns.
    // The desktop's rings take a two-cell slot; the Claude column grows by that one cell.
    expect(widths).toEqual(surface === 'desktop'
      ? [8, 10, 2, 2, 3, 8, 10, 2, 2, 3, 6, 8, 6, 8]
      : [8, 9, 1, 1, 3, 8, 9, 1, 1, 3, 6, 8, 6, 8])
    await ui.press({ key: 'claude-usage' })
    expect((await ui.find({ type: 'Text', text: '✻ Claude usage' }))?.props.color).toBe('#D97757')
    expect((await ui.find({ type: 'Text', text: '❂ Codex usage' }))?.props.color).toBe('#10A39F')
    expect(await block(ui, '✻ Claude usage')).toEqual(['✻ Claude usage', '12%', '5h', '(resets 22h32)', '31%', 'weekly', '(resets Jan 2)'])
    await ui.press({ key: 'claude-usage' })
    await ui.press({ key: 'codex-usage' })
    await ui.unmount()
  }

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Context/ }))?.text).toBe('Context: ✻ Claude 25% · ❂ Codex 19% · ✦ Gemini —')
    expect((await ui.find({ type: 'Text', text: /^Usage/ }))?.text).toBe('Usage: ✻ Claude 5h 12% · wk 31% · ❂ Codex 5h 81% · wk 64% · ✦ Gemini —')
    expect(await ui.find({ type: 'Text', text: /thread/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a session with no Codex thread yet shows a dash and an empty Codex ring', { options: { layout: 'buttons' } }, async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'context-all' } }))
  mock.clock(on, { now: 120_000 })
  mock.store(on)
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000 } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'claude-session-1' }))
  on('env.get', () => ({ value: '/Users/test' }))
  on('process.run', (_, e) => runResult(e.argv[0] === 'date' ? '-0300\n' : JSON.stringify({ error: 'none' })))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ key: 'codex' }))?.text).toBe('—')
  const codexRing = (await ui.findAll({ type: 'Svg' }))[1] as unknown as SvgNode
  expect(svgLabel(codexRing)).toBe('empty —')
  expect(codexRing.props.source).not.toContain('#10A39F')
  expect(await ui.find({ key: 'hide' })).toBeUndefined()
  await ui.press({ key: 'codex' })
  expect(await block(ui, '❂ Codex context', 2)).toEqual(['❂ Codex context', 'no Codex thread in this session yet'])
  expect((await ui.find({ key: 'codex-usage' }))?.text).toBe('—')
  await ui.unmount()
})

test('a session with no reading yet shows the last saved Claude usage', { options: { layout: 'buttons' } }, async ($, on) => {
  const HOUR = 3_600_000
  mock.clock(on, { now: 5 * HOUR })
  mock.store(on, {
    claudeUsage: {
      seenAt: 3 * HOUR,
      windows: [
        { name: '5h', percent: 40, resetsAt: 4 * HOUR },
        { name: 'Weekly', percent: 55, resetsAt: 50 * HOUR },
      ],
    },
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'context-all' } }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000 } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'claude-session-1' }))
  on('env.get', () => ({ value: '/Users/test' }))
  on('process.run', (_, e) => runResult(e.argv[0] === 'date' ? '-0300\n' : JSON.stringify({ error: 'none' })))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  // An empty reading (no reply yet) keeps what was there.
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], changed: [] })

  // The band's button skips the 5h window, which has reset since the reading.
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await band.find({ key: 'claude-usage' }))?.text).toBe('55%')
  await band.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  // The 5h window reset since that reading, so it shows no number.
  expect((await ui.find({ type: 'Text', text: /^Usage/ }))?.text).toBe('Usage: ✻ Claude 5h — · wk 55% · ❂ Codex — · ✦ Gemini —')
  expect(await block(ui, '✻ Claude usage (last reading 2h0m ago)')).toEqual([
    '✻ Claude usage (last reading 2h0m ago)',
    '—',
    '5h',
    '(reset since last reading)',
    '55%',
    'weekly',
    '(resets Jan 2)',
  ])
  expect(await block(ui, '❂ Codex usage', 2)).toEqual(['❂ Codex usage', 'no usage data yet (shows after the first reply)'])
  await ui.unmount()
})

test('a reset 23h59 away shows the time, 24h away the date', { options: { layout: 'buttons' } }, async ($, on) => {
  const MIN = 60_000
  const NOW = Date.UTC(2026, 10, 3, 15, 0)
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'context-all' } }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      rateLimits: [
        { kind: 'five_hour', percentUsed: 1, resetsAt: new Date(NOW + (23 * 60 + 59) * MIN).toISOString() },
        { kind: 'seven_day', percentUsed: 2, resetsAt: new Date(NOW + 24 * 60 * MIN).toISOString() },
      ],
      context: { window: 1_000_000 },
    },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'claude-session-1' }))
  on('env.get', () => ({ value: '/Users/test' }))
  on('process.run', (_, e) => runResult(e.argv[0] === 'date' ? '-0300\n' : JSON.stringify({ error: 'none' })))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'claude-usage' })
  // 15:00 UTC is 12:00 local: 23h59 later is 11h59 tomorrow; 24h later is Nov 4.
  expect(await block(ui, '✻ Claude usage')).toEqual(['✻ Claude usage', '1%', '5h', '(resets 11h59)', '2%', 'weekly', '(resets Nov 4)'])
  await ui.unmount()
})

test('opening a button fetches fresh numbers; closing it does not', { options: { layout: 'buttons' } }, async ($, on) => {
  mock.clock(on, { now: 120_000 })
  mock.store(on)
  let claudePercent = 25
  let codexPercent = 19
  let codexUsagePercent = 81
  let usageCalls = 0
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'context-all' } }))
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: [], context: { tokens: 1000, window: 1_000_000, percent: claudePercent } },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'claude-session-1' }))
  on('env.get', () => ({ value: '/Users/test' }))
  on('process.run', (_, e) => {
    if (e.argv[0] === 'date') {
      return runResult('-0300\n')
    }
    if (e.argv.some(a => a.includes('usage-codex'))) {
      usageCalls += 1

      return runResult(JSON.stringify({ windows: [{ name: '5h', percent: codexUsagePercent, resetsAt: 3_600_000 }] }))
    }

    return runResult(JSON.stringify({ ...CODEX, percent: codexPercent }))
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  // The numbers moved since the last refresh; opening each button shows the new ones.
  claudePercent = 40
  codexPercent = 33
  codexUsagePercent = 90
  const before = usageCalls

  await ui.press({ key: 'claude' })
  expect((await ui.find({ key: 'claude' }))?.text).toBe('40%')
  await ui.press({ key: 'codex' })
  expect((await ui.find({ key: 'codex' }))?.text).toBe('33%')
  await ui.press({ key: 'codex-usage' })
  expect(usageCalls).toBe(before + 1)
  expect((await ui.find({ key: 'codex-usage' }))?.text).toBe('90%')
  expect(await block(ui, '❂ Codex usage', 4)).toEqual(['❂ Codex usage', '90%', '5h', '(resets 22h00)'])

  // Closing fetches nothing.
  await ui.press({ key: 'codex-usage' })
  expect(usageCalls).toBe(before + 1)
  await ui.unmount()
})

test('icons animate while their model works, and settle when it stops', { options: { layout: 'buttons' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 120_000 })
  mock.store(on)
  let codexRunning = false
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'context-all' } }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000 } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'claude-session-1' }))
  on('env.get', () => ({ value: '/Users/test' }))
  on('process.run', (_, e) => {
    if (e.argv[0] === 'date') {
      return runResult('-0300\n')
    }
    if (e.argv.some(a => a.includes('usage-codex'))) {
      return runResult(JSON.stringify({ windows: [] }))
    }

    return runResult(JSON.stringify({ ...CODEX, running: codexRunning }))
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const STILL = await rowIcons(ui)
  expect(STILL).toHaveLength(4)
  const IDLE = ['✻#5C5C5C', '❂#5C5C5C']
  expect(await rowIcons(ui)).toEqual(STILL)
  expect(await indicators(ui)).toEqual(IDLE)

  // Idle: ticks change nothing.
  await clock.advance(1000)
  expect(await indicators(ui)).toEqual(IDLE)

  // Claude works: its indicator (Context row) turns bold orange and cycles; Codex's stays dim.
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(250)
  const first = await indicators(ui)
  await clock.advance(250)
  const second = await indicators(ui)
  expect(first[0]?.endsWith('#D97757*')).toBe(true)
  expect(first[0]).not.toBe(second[0])
  expect(first[1]).toBe('❂#5C5C5C')
  expect(await rowIcons(ui)).toEqual(STILL)

  // A subagent's turn ending does not stop Claude's indicator.
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 's1', agentId: 'sub', reason: 'answer' })
  await clock.advance(250)
  expect((await indicators(ui))[0]?.endsWith('#D97757*')).toBe(true)

  // Claude's turn ends: back to dim.
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await indicators(ui)).toEqual(IDLE)

  // A Codex job from this session runs: its indicator (Usage row) cycles glyphs in green.
  codexRunning = true
  await ui.press({ key: 'codex' })
  const seen = new Set<string>()
  for (let i = 0; i < 4; i += 1) {
    await clock.advance(250)
    const [claudeShown, codexShown] = await indicators(ui)
    expect(claudeShown).toBe('✻#5C5C5C')
    seen.add(codexShown ?? '')
  }
  expect(seen.size).toBeGreaterThan(1)
  expect([...seen].every(g => g.endsWith('#10A39F*'))).toBe(true)
  expect(await rowIcons(ui)).toEqual(STILL)
  codexRunning = false
  await clock.advance(3000)
  expect(await indicators(ui)).toEqual(IDLE)

  // VS Code: every 30 s each image's markup gets a new id, so one stuck as alt text loads again.
  type Image = { props: { source: string } }
  const sourcesOf = async (u: { findAll: (q: { type: string }) => Promise<unknown> }) => ((await u.findAll({ type: 'Svg' })) as unknown as Image[]).map(i => i.props.source)
  expect((await sourcesOf(ui)).some(src => / id="e\d+"/.test(src))).toBe(false)
  const editor = await $.ui.mount({ ...BAND, surface: 'vscode' })
  const before = await sourcesOf(editor)
  expect(before.every(src => / id="e\d+"/.test(src))).toBe(true)
  await clock.advance(30_000)
  const after = await sourcesOf(editor)
  expect(after).not.toEqual(before)
  expect(after.map(src => src.replace(/ id="e\d+"/, ''))).toEqual(before.map(src => src.replace(/ id="e\d+"/, '')))
  await editor.unmount()
  await ui.unmount()
})

test('Codex animates as soon as Claude starts a Codex job', { options: { layout: 'buttons' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 120_000 })
  mock.store(on)
  let codexRunning = false
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'context-all' } }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000 } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'claude-session-1' }))
  on('env.get', () => ({ value: '/Users/test' }))
  on('process.run', (_, e) => {
    if (e.argv[0] === 'date') {
      return runResult('-0300\n')
    }
    if (e.argv.some(a => a.includes('usage-codex'))) {
      return runResult(JSON.stringify({ windows: [] }))
    }

    return runResult(JSON.stringify({ ...CODEX, running: codexRunning }))
  })
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // The job is running, but nothing has checked yet: a status command starts nothing.
  codexRunning = true
  await $.tool.call({ tool: 'Bash', command: 'node "/p/scripts/codex-companion.mjs" status ""' })
  await clock.advance(250)
  expect((await indicators(ui))[1]).toBe('❂#5C5C5C')

  // A background task starts: Codex's indicator animates on the very next frame.
  await $.tool.call({ tool: 'Bash', command: 'node "/p/scripts/codex-companion.mjs" task --background "summarize"' })
  await clock.advance(250)
  expect((await indicators(ui))[1]?.endsWith('#10A39F*')).toBe(true)

  // Just after a start, a status that says "not running" (the job not registered yet) is not
  // trusted; once the grace is over it is.
  codexRunning = false
  await clock.advance(3000)
  await $.tool.call({ tool: 'Bash', command: 'node "/p/scripts/codex-companion.mjs" task --background "next"' })
  await clock.advance(3000)
  expect((await indicators(ui))[1]?.endsWith('#10A39F*')).toBe(true)
  await clock.advance(20_000)
  expect((await indicators(ui))[1]).toBe('❂#5C5C5C')

  // Once a check has seen the job running, its end shows on the next check, with no grace.
  await $.tool.call({ tool: 'Bash', command: 'node "/p/scripts/codex-companion.mjs" task --background "again"' })
  codexRunning = true
  await clock.advance(3000)
  codexRunning = false
  await clock.advance(3000)
  expect((await indicators(ui))[1]).toBe('❂#5C5C5C')

  // A foreground job is over when its call returns: off at once.
  await $.tool.call({ tool: 'Bash', command: 'node "/p/scripts/codex-companion.mjs" task "inline"' })
  await clock.advance(250)
  expect((await indicators(ui))[1]).toBe('❂#5C5C5C')

  // A Codex subagent launching marks Codex as working too; any other agent does not.
  await $.tool.call({ tool: 'Agent', subagent_type: 'Explore', description: 'look', prompt: 'look' })
  await clock.advance(250)
  expect((await indicators(ui))[1]).toBe('❂#5C5C5C')
  await $.tool.call({ tool: 'Agent', subagent_type: 'codex:codex-rescue', description: 'hi', prompt: 'hi' })
  await clock.advance(250)
  expect((await indicators(ui))[1]?.endsWith('#10A39F*')).toBe(true)
  await ui.unmount()
})

test('rings layout: Context and Usage buttons open both models, then rings only', { options: { layout: 'rings' } }, async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'context-all' } }))
  mock.clock(on, { now: 120_000 })
  mock.store(on)
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      rateLimits: [{ kind: 'five_hour', percentUsed: 12, resetsAt: new Date(120_000 + 90 * 60_000).toISOString() }],
      context: { tokens: 253_800, window: 1_000_000, percent: 25 },
    },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'claude-session-1' }))
  on('env.get', () => ({ value: '/Users/test' }))
  let usageRuns = 0
  on('process.run', (_, e) => {
    if (e.argv[0] === 'date') {
      return runResult('-0300\n')
    }
    if (e.argv.some(a => a.includes('usage-codex'))) {
      usageRuns += 1

      return runResult(JSON.stringify(CODEX_USAGE))
    }

    return runResult(JSON.stringify(CODEX))
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // Two buttons, no per-model buttons; the rings carry the numbers.
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['Context', 'Usage'])
  const alts = async () => ((await ui.findAll({ type: 'Svg' })) as unknown as SvgNode[]).map(svgLabel)
  expect(await alts()).toEqual(['Claude 25%', 'Codex 19%', 'Claude 12%', 'Codex 81%'])
  // Context is a pill bar, usage a ring.
  const shapes = ((await ui.findAll({ type: 'Svg' })) as unknown as { props: { source: string } }[]).map(r => (r.props.source.includes('<rect') ? 'bar' : 'ring'))
  expect(shapes).toEqual(['bar', 'bar', 'ring', 'ring'])
  // The thinking indicators stay at the far right: Claude's on Context, Codex's on Usage.
  expect(await indicators(ui)).toEqual(['✻#5C5C5C', '❂#5C5C5C'])
  expect((await ui.findAll({ type: 'Box' })).map(b => b.props.width).filter(w => w !== undefined)).toEqual([11, 4, 4, 3, 11, 4, 4, 3])

  // Context opens both models' details, and closes both.
  await ui.press({ key: 'context' })
  expect(await lines(ui)).toContain('✻ Claude context')
  expect(await lines(ui)).toContain('❂ Codex context')
  await ui.press({ key: 'context' })
  expect(await lines(ui)).not.toContain('✻ Claude context')
  expect(await lines(ui)).not.toContain('❂ Codex context')

  // Usage opens both, fetching Codex's fresh.
  const before = usageRuns
  await ui.press({ key: 'usage' })
  expect(usageRuns).toBe(before + 1)
  expect(await lines(ui)).toContain('✻ Claude usage')
  expect(await lines(ui)).toContain('❂ Codex usage')
  expect(await alts()).toEqual(['Claude 25%', 'Codex 19%', 'Claude 12%', 'Codex 81%'])
  await ui.press({ key: 'usage' })
  expect(await lines(ui)).not.toContain('❂ Codex usage')
  await ui.unmount()

  // The terminal has no Svg: each ring is its glyph and number.
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await lines(term)).toEqual(expect.arrayContaining(['✻ 25%', '❂ 19%', '✻ 12%']))
  // Context details sit between the Context row and the Usage row.
  await term.press({ key: 'context' })
  const shown = await lines(term)
  expect(shown.indexOf('❂ 19%')).toBeLessThan(shown.indexOf('✻ Claude context'))
  expect(shown.indexOf('❂ Codex context')).toBeLessThan(shown.indexOf('✻ 12%'))
  await term.press({ key: 'context' })
  await term.unmount()
})

test('models layout (default): Claude, Codex and Gemini groups, then the +/- button', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'context-all' } }))
  const clock = mock.clock(on, { now: 120_000 })
  mock.store(on)
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      rateLimits: [{ kind: 'five_hour', percentUsed: 12, resetsAt: new Date(120_000 + 90 * 60_000).toISOString() }],
      context: { tokens: 253_800, window: 1_000_000, percent: 25 },
    },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.id', () => ({ value: 'claude-session-1' }))
  on('session.cwd', () => ({ value: '/work/repo' }))
  on('env.get', () => ({ value: '/Users/test' }))
  const scripts: string[][] = []
  let geminiRunning = false
  on('process.run', (_, e) => {
    if (e.argv[0] === 'python3') {
      scripts.push(e.argv.slice(2))
    }
    if (e.argv[0] === 'date') {
      return runResult('-0300\n')
    }
    const name = e.argv[2]?.split('/').pop()
    const answers: Record<string, unknown> = {
      'usage-codex.py': CODEX_USAGE,
      'context-gemini.py': { ...GEMINI, running: geminiRunning },
      'usage-gemini.py': GEMINI_USAGE,
    }

    return runResult(JSON.stringify(answers[name ?? ''] ?? CODEX))
  })
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // Usage loads in the background at start: let it land.
  await clock.advance(10)
  // The scripts run from the mod's own folder, not from the user's home. Gemini's context
  // script waits for Gemini to be started from this session.
  const paths = scripts.map(s => s[0] ?? '')
  expect(paths.every(path => path.startsWith('/') && /\/scripts\/[a-z-]+\.py$/.test(path) && !path.startsWith('/Users/test/.claude/'))).toBe(true)
  expect(new Set(paths.map(path => path.split('/').pop()))).toEqual(new Set(['context-codex.py', 'usage-codex.py', 'usage-gemini.py']))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['+'])
  expect(await lines(ui)).not.toContain('Context:')
  const svgs = async () => ((await ui.findAll({ type: 'Svg' })) as unknown as SvgNode[])
    .map(r => {
      const window = /<text[^>]*>([^<]+)<\/text>/.exec(r.props.source)?.[1]

      return `${svgLabel(r)} ${window ? `${window} ring` : r.props.source.includes('<rect') ? 'bar' : 'ring'}`
    })
  // Each group: the 5h ring, the 1w ring, the context bar. A ring with a reading shows the time to
  // its reset, rounded down (Claude's 5h in 90 min: `1h`); one without shows its window's name. Gemini has
  // usage but no conversation from this session yet: an empty bar.
  expect(await svgs()).toEqual([
    'Claude 12% 1h ring', 'empty — 1w ring', 'Claude 25% bar',
    'Codex 81% 1h ring', 'Codex 64% 4d ring', 'Codex 19% bar',
    'Gemini 40% 2h ring', 'Gemini 10% 5d ring', 'empty — bar',
  ])
  // The weekly ring's line is thicker than the 5h one's.
  const strokes = ((await ui.findAll({ type: 'Svg' })) as unknown as SvgNode[]).flatMap(r => {
    const window = /<text[^>]*>([^<]+)<\/text>/.exec(r.props.source)?.[1]

    return window ? [`${window} ${/stroke-width="([\d.]+)"/.exec(r.props.source)?.[1]}`] : []
  })
  expect(strokes).toEqual(['1h 0.75', '1w 1.5', '1h 0.75', '4d 1.5', '2h 0.75', '5d 1.5'])
  // A label's color follows its window's usage: gray below 50% and with no reading, grayish
  // yellow from 50%, amber from 70%.
  const labelColors = async () =>
    ((await ui.findAll({ type: 'Svg' })) as unknown as SvgNode[]).flatMap(r => /fill="(#[0-9A-F]+)">([^<]+)<\/text>/.exec(r.props.source)?.slice(1, 3).reverse().join(' ') ?? [])
  expect(await labelColors()).toEqual(['1h #8E8E8E', '1w #8E8E8E', '1h #D9A13B', '4d #A89B6A', '2h #8E8E8E', '5d #8E8E8E'])
  // The time counts down, redrawn once a minute: 31 minutes on, Claude's 5h shows `59m`, in the
  // smaller size three characters need.
  await clock.advance(31 * 60_000)
  const claude5h = ((await ui.findAll({ type: 'Svg' })) as unknown as SvgNode[])[0]?.props.source ?? ''
  expect(claude5h).toContain('>59m</text>')
  expect(claude5h).toContain('font-size="4"')

  // One row: three groups spread out, the button at the end.
  type RowNode = { type: string; key?: string; props: { flexGrow?: number; gap?: string | number; width?: number }; children: RowNode[] }
  const row = (await ui.findAll({ type: 'Box' }))[1] as unknown as RowNode
  expect(row.children.map(n => n.key ?? (n.props.flexGrow ? 'grow' : n.type))).toEqual(['Box', 'grow', 'Box', 'grow', 'Box', 'grow', 'Button'])
  // Each group: its indicator, then its marks sharing one gap with no slot around them.
  const groups = [row.children[0], row.children[2], row.children[4]] as RowNode[]
  // The indicator sits in a two-cell slot, as close to its rings as the rings are to each other.
  expect(groups.map(g => [g.props.gap, g.children[0]?.props.width])).toEqual([['xs', 2], ['xs', 2], ['xs', 2]])
  expect(groups.map(g => g.children[1]?.props.gap)).toEqual(['xs', 'xs', 'xs'])
  expect(groups.map(g => g.children[1]?.children.map(n => n.type).join(','))).toEqual(['Svg,Svg,Svg', 'Svg,Svg,Svg', 'Svg,Svg,Svg'])
  expect((await glyphs(ui)).slice(0, 3)).toEqual(['✻#5C5C5C', '❂#5C5C5C', '✦#5C5C5C'])

  // A Gemini subagent launching marks Gemini as working: its indicator animates in its color,
  // and its conversation is looked up from this session's start on.
  geminiRunning = true
  await $.tool.call({ tool: 'Agent', subagent_type: 'agy:runner', description: 'ask', prompt: 'hi' })
  await clock.advance(250)
  const geminiGlyph = (await glyphs(ui))[2] ?? ''
  expect(geminiGlyph.endsWith('#3487FF*')).toBe(true)
  const lookup = scripts.find(s => s[0]?.endsWith('context-gemini.py'))
  expect(lookup?.slice(1)).toEqual(['--json', '--cwd', '/work/repo', '--since', String(120_000 + 10 + 31 * 60_000)])
  expect((await svgs())[8]).toBe('Gemini 5% bar')
  // Once its run is seen to end, Gemini settles.
  geminiRunning = false
  await clock.advance(3000)
  expect((await glyphs(ui))[2]).toBe('✦#5C5C5C')

  // `+` opens everything, by model, and turns into `-`.
  await ui.press({ key: 'expand' })
  expect((await ui.find({ key: 'expand' }))?.text).toBe('-')
  const shown = (await lines(ui)).filter(l => / (context|usage)$/.test(l))
  const all = await lines(ui)
  // The details open above the row: every heading comes before the row's indicators.
  expect(all.indexOf('✦ Gemini usage')).toBeLessThan(all.indexOf('✻'))
  expect(shown).toEqual(['✻ Claude context', '✻ Claude usage', '❂ Codex context', '❂ Codex usage', '✦ Gemini context', '✦ Gemini usage'])
  expect(all).toContain('52,429 / 1,048,576 tokens')
  type Node = { type: string; props: { flexWrap?: string; width?: number; minWidth?: string; flexShrink?: number }; children: Node[] }
  const wrap = ((await ui.findAll({ type: 'Box' })) as unknown as Node[]).find(b => b.props.flexWrap === 'wrap')
  // Three columns sized by their own text, never shrunk; the first two take at least a third each.
  expect(wrap?.children.map(c => [c.props.width, c.props.minWidth, c.props.flexShrink])).toEqual([[undefined, '33%', 0], [undefined, '33%', 0], [undefined, undefined, 0]])
  // Each heading is followed by its bar or its two rings, then the row's marks.
  expect((await svgs()).slice(0, 9)).toEqual([
    'Claude 25% bar', 'Claude 12% 58m ring', 'empty — 1w ring',
    'Codex 19% bar', 'Codex 81% 1h ring', 'Codex 64% 4d ring',
    'Gemini 5% bar', 'Gemini 40% 2h ring', 'Gemini 10% 5d ring',
  ])
  const sources = ((await ui.findAll({ type: 'Svg' })) as unknown as { props: { source: string } }[]).slice(0, 9).map(r => r.props.source)
  // The fill is exactly its share of the bar: 25% of 21px is 5.25px, clipped to the pill.
  expect(sources[0]).toContain('width="5.25" height="7" fill="#D97757" clip-path="url(#pill)"')
  expect(sources.some(src => src.includes('matrix(-1'))).toBe(false)

  // `-` closes everything.
  await ui.press({ key: 'expand' })
  expect((await ui.find({ key: 'expand' }))?.text).toBe('+')
  expect((await lines(ui)).filter(l => / (context|usage)$/.test(l))).toEqual([])
  await ui.unmount()
})
