import { Router } from 'express';
import type { ApiContract, ContractMethod } from '../contracts.js';
import { HttpError } from '../http/errors.js';

export const modulePrefixes = {
  accounts: ['auth', 'staff', 'customers'],
  catalog: ['products', 'plans', 'taxes', 'payment-terms', 'quotation-templates', 'discounts'],
  subscriptions: ['subscriptions'],
  billing: ['invoices', 'payments', 'billing-runs'],
  reporting: ['reports', 'portal'],
} as const;

export function createApiRouter(contract: ApiContract): Router {
  const router = Router();
  const covered = new Set<string>();
  // Register concrete paths before parameter paths. Never serve fixture data as real data.
  const paths = Object.entries(contract.paths).sort(([a], [b]) =>
    (a.match(/\{/g)?.length ?? 0) - (b.match(/\{/g)?.length ?? 0));
  for (const prefixes of Object.values(modulePrefixes)) {
    const moduleRouter = Router();
    for (const [path, operations] of paths) {
      if (!(prefixes as readonly string[]).includes(path.split('/')[1] ?? '')) continue;
      for (const method of ['get', 'post', 'patch'] as ContractMethod[]) {
        const operation = operations[method];
        if (!operation) continue;
        covered.add(`${method} ${path}`);
        const expressPath = path.replace(/\{([^}]+)\}/g, ':$1');
        moduleRouter[method](expressPath, (_req, _res, next) => {
          next(new HttpError(501, 'NOT_IMPLEMENTED', `Operation ${operation.operationId} is not implemented yet.`));
        });
      }
    }
    router.use(moduleRouter);
  }
  const expected = Object.values(contract.paths).reduce((n, operations) => n + Object.keys(operations).length, 0);
  if (covered.size !== expected) throw new Error('Some API operations have no assigned backend module.');
  return router;
}
