import escapeStringRegexp from 'escape-string-regexp'
import { describe, expect, it } from 'vitest'
import { buildTree, parsePath, toRegExp } from '../../src'

const greedyParams: Record<string, string> = {
  'dynamic': '[^/]+',
  'optional': '[^/]*',
  'repeatable': '[^/]+(?:/[^/]+)*',
  'optional-repeatable': '[^/]*(?:/[^/]+)*',
  'catchall': '.*',
}

/** Reference matcher: the same route as a plain greedy left-to-right pattern. */
function greedyRegExp(file: string): RegExp {
  let source = '^'
  for (const segment of parsePath([file])[0]!.segments) {
    if (segment.every(t => t.type === 'group'))
      continue
    let re = ''
    for (const token of segment) {
      const key = token.value.replace(/^(\d)/, '_$1').replace(/\./g, '')
      if (token.type === 'static')
        re += escapeStringRegexp(token.value)
      else if (token.type !== 'group')
        re += `(?<${key}>${greedyParams[token.type]})`
    }
    const isOptional = segment.every(t => t.type === 'optional' || t.type === 'catchall' || t.type === 'group' || t.type === 'optional-repeatable')
    if (re) {
      source += isOptional
        ? `(?:\\/${re})?`
        : `\\/${re}`
    }
  }
  return new RegExp(`${source}\\/?$`)
}

function exec(pattern: RegExp, input: string) {
  const match = pattern.exec(input)
  return match && {
    match: match[0],
    groups: { ...match.groups },
  }
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const shapes = {
  'export/[lang]-[region]-[slug].json.vue': [
    '/export/en-gb-guide.json',
    '/export/a-b-c-d.json',
    '/export/--x-.json',
    '/export/a-b.json',
  ],
  'three/[...a]/x/[...b]/x/[...c]/z.vue': [
    '/three/x/x/z',
    '/three/p/x/q/x/r/z',
    '/three/x/x/x/x/z',
    '/three/x/x/x/z/',
    '/three/x/q/x/z',
  ],
  'rep/[a]+/x/[b]+/x/[c]+/z.vue': [
    '/rep/p/x/q/x/r/z',
    '/rep/x/x/x/x/x/x/z',
    '/rep/p/q/x/r/x/s/t/z/',
    '/rep/p//x/q/x/r/z',
  ],
  '[a]-[b].vue': ['/x-y-z', '/x--y', '/-x-', '/x-y-z/'],
  '[a]-[...b].vue': ['/x-y/z-w', '/x-y-z', '/x-\n/y'],
  '[...a]-[b].vue': ['/x-y\n-z', '/p/q-r-s', '/x-y-z'],
  '[...a]/[b]/[...c].vue': ['/p/q/r/s', '/\n/q/r', '/p'],
  '[a]+/[...b].vue': ['/x/y//z', '/x/y/z', '//x'],
  '[[a]]/[[b]]/[...c].vue': ['/', '/x', '/x/', '/x/y/z/w', '//'],
  'foo[...id]bar.vue': ['/fooa/b/cbar', '/foobar', '/foo/x/bar'],
  'a/[...slug]-x.vue': ['/a/b/c-x', '/a/-x-x', '/a/-x'],
}

describe('toRegExp', () => {
  it('should extract params from ambiguous paths like greedy matching does', () => {
    const [ab] = toRegExp(buildTree(['[a]-[b].vue']))
    expect(exec(ab!.pattern, '/x-y-z')?.groups).toEqual({ a: 'x-y', b: 'z' })

    const [three] = toRegExp(buildTree(['three/[...a]/x/[...b]/x/[...c]/z.vue']))
    expect(exec(three!.pattern, '/three/p/x/q/x/r/x/z')?.groups).toEqual({ a: 'p/x/q', b: 'r', c: undefined })

    const [rep] = toRegExp(buildTree(['rep/[a]+/x/[b]+/x/[c]+/z.vue']))
    expect(exec(rep!.pattern, '/rep/x/x/x/x/x/x/z')?.groups).toEqual({ a: 'x/x', b: 'x', c: 'x' })

    for (const [file, inputs] of Object.entries(shapes)) {
      const [route] = toRegExp(buildTree([file]))
      const greedy = greedyRegExp(file)
      for (const input of inputs)
        expect(exec(route!.pattern, input), `${file} ${JSON.stringify(input)}`).toEqual(exec(greedy, input))
    }
  })

  it('should match exactly what greedy matching matches on randomised routes', () => {
    const random = mulberry32(0x5EED)
    const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!
    const pieces = [
      '[a]',
      '[[a]]',
      '[...a]',
      '[[...a]]',
      '[a]+',
      '[[a]]+',
      'x',
      '-',
      '--',
      '-x',
      'x-',
      '.json',
      'é',
      '\n',
      '(g)',
    ]
    const alphabet = [
      'x',
      '-',
      '--',
      '/',
      '/',
      '//',
      '.json',
      '.',
      'é',
      'x-',
      '\n',
      '\u2028',
    ]

    let id = 0
    let matched = 0
    for (let r = 0; r < 400; r++) {
      const segments = Array.from({ length: 1 + Math.floor(random() * 4) }, () =>
        Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(pieces)).join(''))
      const file = `${segments.join('/').replace(/a\]/g, () => `p${id++}]`)}.vue`
      const [route] = toRegExp(buildTree([file]))
      const greedy = greedyRegExp(file)
      for (let i = 0; i < 150; i++) {
        let input = random() < 0.95
          ? '/'
          : ''
        for (let n = Math.floor(random() * 10); n > 0; n--)
          input += pick(alphabet)
        const expected = exec(greedy, input)
        if (expected)
          matched++
        expect(exec(route!.pattern, input), `${file} ${JSON.stringify(input)}`).toEqual(expected)
      }
    }
    expect(matched).toBeGreaterThan(1000)
  })

  it('should resolve pathological paths in linear time', () => {
    const xs = (n: number) => Array.from({ length: n }).fill('x').join('/')
    const cases: [string, string, Record<string, string | undefined> | undefined][] = [
      ['export/[lang]-[region]-[slug].json.vue', `/export/${'-'.repeat(2000)}X`, undefined],
      ['export/[lang]-[region]-[slug].json.vue', `/exporX/${'-'.repeat(10000)}.json`, undefined],
      [
        'export/[lang]-[region]-[slug].json.vue',
        `/export/a${'-'.repeat(10000)}b.json`,
        { lang: `a${'-'.repeat(9997)}`, region: '-', slug: 'b' },
      ],
      ['three/[...a]/x/[...b]/x/[...c]/z.vue', `/three${'/x'.repeat(1000)}/X`, undefined],
      ['three/[...a]/x/[...b]/x/[...c]/z.vue', `/threX${'/x'.repeat(5000)}/z`, undefined],
      [
        'three/[...a]/x/[...b]/x/[...c]/z.vue',
        `/three${'/x'.repeat(5000)}/z`,
        {
          a: xs(4998),
          b: undefined,
          c: undefined,
        },
      ],
      ['rep/[a]+/x/[b]+/x/[c]+/z.vue', `/rep${'/x'.repeat(1000)}/X`, undefined],
      ['rep/[a]+/x/[b]+/x/[c]+/z.vue', `/reX${'/x'.repeat(5000)}/z`, undefined],
      [
        'rep/[a]+/x/[b]+/x/[c]+/z.vue',
        `/rep${'/x'.repeat(5000)}/z`,
        {
          a: xs(4996),
          b: 'x',
          c: 'x',
        },
      ],
      ['rep/[[a]]+/x/[[b]]+/x/[[c]]+/z.vue', `/rep${'/x'.repeat(1000)}/X`, undefined],
      ['rep/[[a]]+/x/[[b]]+/x/[[c]]+/z.vue', `/reX${'/x'.repeat(5000)}/z`, undefined],
      [
        'rep/[[a]]+/x/[[b]]+/x/[[c]]+/z.vue',
        `/rep${'/x'.repeat(5000)}/z`,
        {
          a: xs(4998),
          b: undefined,
          c: undefined,
        },
      ],
      ['[...a]-[b].vue', `/\n${'-x'.repeat(5000)}`, undefined],
      ['[a]-[...b].vue', `/x${'-/'.repeat(5000)}\n`, undefined],
      ['[a]+/[...b].vue', `//${'x/'.repeat(5000)}`, undefined],
      ['rep/[a]+/x/[b]+.vue', `/rep/${'y/'.repeat(18)}y!`, undefined],
      ['[a]+-[b]+.vue', `/${'y/'.repeat(18)}y-//`, undefined],
      ['rep/[a]+/x/[b]+.vue', `/rep/${'y/'.repeat(5000)}y!`, undefined],
      ['[a]+-[b]+.vue', `/${'y/'.repeat(5000)}y-//`, undefined],
      ['-[[a]]+/[[b]]/[...c]/[d]+.vue', `/X/${'-/'.repeat(5000)}`, undefined],
    ]
    for (const [file, input, groups] of cases) {
      const [route] = toRegExp(buildTree([file]))
      const start = performance.now()
      const result = exec(route!.pattern, input)
      expect(performance.now() - start, file).toBeLessThan(50)
      expect(result?.groups, file).toEqual(groups)
    }
  })
})
