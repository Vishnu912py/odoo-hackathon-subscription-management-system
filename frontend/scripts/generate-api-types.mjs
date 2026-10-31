import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const source = readFileSync(new URL('../../docs/api/openapi.json', import.meta.url), 'utf8')
const contract = JSON.parse(source)
const target = new URL('../src/api/schema.ts', import.meta.url)
function type(schema) {
  if (schema.$ref) return schema.$ref.split('/').at(-1)
  if (schema.enum) return schema.enum.map(value => JSON.stringify(value)).join(' | ')
  if (schema.anyOf) return schema.anyOf.map(type).join(' | ')
  if (schema.oneOf) return schema.oneOf.map(type).join(' | ')
  if (schema.allOf) return schema.allOf.map(type).join(' & ')
  if (schema.type === 'array') return `Array<${type(schema.items)}>`
  if (schema.type === 'object') {
    const fields = Object.entries(schema.properties ?? {}).map(([name, value]) =>
      `${JSON.stringify(name)}${schema.required?.includes(name) ? '' : '?'}: ${type(value)}`)
    if (schema.additionalProperties) fields.push(`[key: string]: ${schema.additionalProperties === true ? 'unknown' : type(schema.additionalProperties)}`)
    return `{ ${fields.join('; ')} }`
  }
  if (schema.type === 'integer' || schema.type === 'number') return 'number'
  if (['string', 'boolean', 'null'].includes(schema.type)) return schema.type
  throw new Error(`Unsupported schema: ${JSON.stringify(schema)}`)
}
const output = '// Generated from docs/api/openapi.json. Do not edit manually.\n' +
  `// Source SHA-256: ${createHash('sha256').update(JSON.stringify(contract)).digest('hex')}\n\n` +
  Object.entries(contract.components.schemas).map(([name, schema]) => `export type ${name} = ${type(schema)}\n`).join('\n')
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== output) throw new Error('API types are stale. Run npm run api:generate.')
  console.log('API types match the shared contract.')
} else {
  writeFileSync(target, output)
  console.log('Generated API types from the shared contract.')
}
