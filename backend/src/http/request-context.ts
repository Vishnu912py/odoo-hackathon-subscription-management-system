import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export interface RequestLog {
  request_id: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
}

export const requestContext: RequestHandler = (_req, res, next) => {
  const id = randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  res.setHeader('Cache-Control', 'no-store');
  next();
};

export function requestLogger(write: (entry: RequestLog) => void): RequestHandler {
  return (req, res, next) => {
    const started = performance.now();
    res.once('finish', () => {
      write({
        request_id: res.locals.requestId as string,
        method: req.method,
        path: req.path, // No query strings, bodies, cookies, authorization or database URLs.
        status: res.statusCode,
        duration_ms: Math.round(performance.now() - started),
      });
    });
    next();
  };
}
