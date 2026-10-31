import { readFileSync } from 'node:fs';

export type ContractMethod = 'get' | 'post' | 'patch';
export interface ContractOperation {
  operationId: string;
  summary: string;
  'x-roles': string[];
}
export interface ApiContract {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Partial<Record<ContractMethod, ContractOperation>>>;
}

// src/ and dist/ have the same depth. Keep the repository docs with deployments.
export const contractPath = new URL('../../docs/api/openapi.json', import.meta.url);
export function loadContract(): ApiContract {
  const contract: unknown = JSON.parse(readFileSync(contractPath, 'utf8'));
  if (!contract || typeof contract !== 'object' || !('paths' in contract) || !('info' in contract)) {
    throw new Error('The shared OpenAPI contract is invalid or missing.');
  }
  return contract as ApiContract;
}
