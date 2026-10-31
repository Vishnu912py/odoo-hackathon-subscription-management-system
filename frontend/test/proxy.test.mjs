import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { loadConfigFromFile } from 'vite'

test('Vite forwards API and health paths, preserves the browser Origin and reserves port 5173', async () => {
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, fileURLToPath(new URL('../vite.config.ts', import.meta.url)))
  assert.ok(loaded)
  const { server } = loaded.config
  assert.equal(server.port, 5173)
  assert.equal(server.strictPort, true)
  for (const path of ['/api', '/health']) {
    assert.equal(server.proxy[path].target, process.env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:3000')
    assert.equal(server.proxy[path].rewrite, undefined)
    assert.notEqual(server.proxy[path].changeOrigin, true)
  }
})
