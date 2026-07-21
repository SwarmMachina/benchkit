import assert from 'node:assert/strict'
import test from 'node:test'
import cpuGuard from '../../src/cpu-guard.ts'

const profile = {
  totalTicks: 200,
  unaccountedTicks: 20,
  excludedTicks: 0,
  summary: {
    javascript: { ticks: 100, totalPct: 50, nonlibPct: 50 },
    c: { ticks: 40, totalPct: 20, nonlibPct: 20 },
    gc: { ticks: 10, totalPct: 5, nonlibPct: 5 },
    unaccounted: { ticks: 20, totalPct: 10, nonlibPct: null }
  },
  topJavaScript: [],
  topNative: [],
  topSharedLibraries: []
}

test('cpuGuard is disabled when no guard is configured', () => {
  assert.deepEqual(cpuGuard({ cpuProfiles: [], guard: undefined, expectedKeys: [] }), {
    failures: [],
    rows: []
  })
})

test('cpuGuard returns parsed profile rows', () => {
  const result = cpuGuard({
    cpuProfiles: [{ test: 'base', run: 1, fw: 'core', profile }],
    guard: { profileRequired: true, minTotalTicks: 100, maxGcPct: 10, maxUnaccountedPct: 20 },
    expectedKeys: ['base:1:core']
  })

  assert.deepEqual(result, {
    failures: [],
    rows: [
      {
        key: 'base:1:core',
        ticks: 200,
        jsPct: 50,
        cppPct: 20,
        gcPct: 5,
        unaccountedPct: 10
      }
    ]
  })
})

test('cpuGuard reports missing and out-of-bounds profiles', () => {
  const result = cpuGuard({
    cpuProfiles: [
      {
        test: 'base',
        run: 1,
        fw: 'core',
        profile: {
          ...profile,
          totalTicks: 50,
          summary: {
            ...profile.summary,
            gc: { ticks: 20, totalPct: 20, nonlibPct: 20 },
            unaccounted: { ticks: 40, totalPct: 40, nonlibPct: null }
          }
        }
      }
    ],
    guard: { profileRequired: true, minTotalTicks: 100, maxGcPct: 10, maxUnaccountedPct: 30 },
    expectedKeys: ['base:1:core', 'base:2:core']
  })

  assert.deepEqual(result.failures, [
    'base:1:core: CPU profile ticks 50 < 100',
    'base:1:core: GC 20% > 10%',
    'base:1:core: unaccounted 40% > 30%',
    'base:2:core: missing CPU profile'
  ])
})
