import type { ErrorRequestHandler, RequestHandler } from 'express';

export interface FieldError {
  path: string;
  code: string;
  message: string;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields: FieldError[] = [],
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'NOT_FOUND', 'The requested endpoint does not exist.'));
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) { next(error); return; }
  let failure = error instanceof HttpError ? error : undefined;
  if (!failure && error && typeof error === 'object' && 'type' in error) {
    if (error.type === 'entity.parse.failed') {
      failure = new HttpError(400, 'MALFORMED_REQUEST', 'The request body must contain valid JSON.');
    } else if (error.type === 'entity.too.large') {
      failure = new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The JSON request body exceeds the 100 KB limit.');
    } else if (error.type === 'charset.unsupported' || error.type === 'encoding.unsupported') {
      failure = new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use UTF-8 JSON without unsupported content encoding.');
    }
  }
  failure ??= new HttpError(500, 'INTERNAL_ERROR', 'An unexpected server error occurred.');
  res.status(failure.status).json({
    error: {
      code: failure.code,
      message: failure.message,
      fields: failure.fields,
      request_id: res.locals.requestId as string,
    },
  });
};
