import { mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
const root = new URL('../', import.meta.url);
mkdirSync(new URL('src/generated', root), { recursive: true });
const contract = JSON.parse(readFileSync(new URL('../docs/api/openapi.json', root), 'utf8'));
writeFileSync(new URL('src/generated/api-contract.ts', root), `// Generated from docs/api/openapi.json; do not edit.\nexport default ${JSON.stringify(contract)};\n`);
mkdirSync(new URL('dist/assets', root), { recursive: true });
cpSync(new URL('package.json', root), new URL('dist/package.json', root));
cpSync(new URL('src/assets', root), new URL('dist/assets', root), { recursive: true });
