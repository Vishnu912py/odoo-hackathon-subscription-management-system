import { Ajv2020 } from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import { createRequire } from 'node:module';
import type { RequestHandler } from 'express';
import { loadContract } from '../contracts.js';
import { HttpError } from './errors.js';

// OpenAPI's JSON Schema definitions are also the runtime validation source.
const addFormats = createRequire(import.meta.url)('ajv-formats') as typeof formats.default;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const contract = loadContract() as unknown as {
  components: { schemas: Record<string, object> };
  paths: Record<string, Record<string, { parameters: { name: string; in: string; required: boolean; schema: Record<string, unknown> }[] }>>;
};
ajv.addSchema({ $id: 'contract', components: contract.components });

export function validateBody(name: string): RequestHandler {
  const validate = ajv.compile({ $ref: `contract#/components/schemas/${name}` });
  return (req, _res, next) => {
    if (!validate(req.body)) throw new HttpError(422, 'VALIDATION_ERROR', 'Check the submitted fields.',
      (validate.errors ?? []).map(e => ({ path: e.instancePath || '/', code: e.keyword, message: e.message ?? 'Invalid value' })));
    next();
  };
}

export function validateQuery(path: string): RequestHandler {
  const parameters = contract.paths[path]?.get?.parameters.filter(p => p.in === 'query') ?? [];
  const validator = ajv.compile({ type: 'object', additionalProperties: false,
    properties: Object.fromEntries(parameters.map(p => [p.name, p.schema])),
    required: parameters.filter(p => p.required).map(p => p.name) });
  return (req, res, next) => {
    const values: Record<string, unknown> = { ...req.query };
    for (const p of parameters) {
      const value = values[p.name];
      if (typeof value !== 'string') continue;
      if (p.schema.type === 'integer' && /^[0-9]+$/.test(value)) values[p.name] = Number(value);
      if (p.schema.type === 'boolean' && ['true', 'false'].includes(value)) values[p.name] = value === 'true';
    }
    if (!validator(values)) throw new HttpError(400, 'MALFORMED_REQUEST', 'Invalid or unsupported query parameters.');
    if (values.from && values.to && String(values.from) > String(values.to)) throw new HttpError(400, 'MALFORMED_REQUEST', 'from must not follow to.');
    res.locals.query = values;
    next();
  };
}
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
