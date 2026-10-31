import generatedContract from './generated/api-contract.js';

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

export function loadContract(): ApiContract {
  const contract: unknown = generatedContract;
  if (!contract || typeof contract !== 'object' || !('paths' in contract) || !('info' in contract)) {
    throw new Error('The shared OpenAPI contract is invalid or missing.');
  }
  return contract as ApiContract;
}
