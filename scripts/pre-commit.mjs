// @ts-check
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { sync as spawnSync } from 'cross-spawn'

/**
 * @param {string} cmd
 * @param {string[]} args
 * @returns {boolean}
 */
const tryCommand = (cmd, args) => {
  const result = spawnSync(cmd, args, { stdio: 'ignore' })
  if (result.error) {
    return false
  }
  return result.status === 0
}

/**
 * @returns {{ cmd: string; argsPrefix: string[]; source: string } | null}
 */
const resolvePnpm = () => {
  if (tryCommand('pnpm', ['--version'])) {
    return { cmd: 'pnpm', argsPrefix: [], source: 'PATH' }
  }
  if (
    tryCommand('mise', ['--version']) &&
    tryCommand('mise', ['exec', '--', 'pnpm', '--version'])
  ) {
    return { cmd: 'mise', argsPrefix: ['exec', '--', 'pnpm'], source: 'mise' }
  }
  return null
}

const runner = resolvePnpm()
if (!runner) {
  console.error(
    [
      'ERROR: pnpm not found.',
      'Expected to find pnpm on PATH or via "mise exec -- pnpm".',
      'Fix one of:',
      '- Ensure pnpm is on PATH for git hooks',
      '- Or install/configure mise and run "mise install"'
    ].join('\n')
  )
  process.exit(1)
}

/**
 * @param {string[]} args
 * @returns {void}
 */
const runPnpm = (args) => {
  const result = spawnSync(runner.cmd, [...runner.argsPrefix, ...args], {
    stdio: 'inherit'
  })
  if (result.error) {
    console.error(`ERROR: failed to run pnpm via ${runner.source}`)
    process.exit(1)
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status)
  }
  if (result.signal) {
    process.exit(1)
  }
}

const args = process.argv.slice(2)
if (args.length > 0) {
  runPnpm(args)
} else {
  runPnpm(['lint-staged'])
  runPnpm(['typecheck'])
}
