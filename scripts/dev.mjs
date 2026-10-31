import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const children = []
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  process.exitCode = code
}
for (const [directory, script, args] of [
  ['backend', 'node_modules/tsx/dist/cli.mjs', ['watch', 'src/server.ts']],
  ['frontend', 'node_modules/vite/bin/vite.js', []],
  ['backend', 'node_modules/tsx/dist/cli.mjs', ['scripts/billing_worker.ts', '--watch']],
]) {
  const cwd = fileURLToPath(new URL(`${directory}/`, root))
  const child = spawn(process.execPath, [script, ...args], { cwd, stdio: 'inherit', windowsHide: true })
  children.push(child)
  child.on('error', error => { console.error(`${directory}: ${error.message}`); stop(1) })
  child.on('exit', code => { if (!stopping) stop(code ?? 1) })
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
