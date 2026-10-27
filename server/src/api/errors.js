import { ZodError } from 'zod';
import { PortalError } from '../portal/client.js';

export class HttpError extends Error {
  constructor(status, title, detail) {
    super(detail ?? title);
    this.status = status;
    this.title = title;
    this.detail = detail;
  }
}

export const notFound = (detail) => new HttpError(404, 'Not Found', detail);

/** Validate a request part, turning zod errors into a readable 400. */
export function parse(schema, value) {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) {
      const detail = err.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; ');
      throw new HttpError(400, 'Bad Request', detail);
    }
    throw err;
  }
}

/** Every error leaves as application/problem+json. */
export const errorHandler = (log) => (err, _req, res, _next) => {
  let status = 500;
  let title = 'Internal Server Error';
  let detail;
  if (err instanceof HttpError) {
    ({ status, title, detail } = err);
  } else if (err instanceof RangeError) {
    status = 400;
    title = 'Bad Request';
    detail = err.message;
  } else if (err instanceof PortalError) {
    status = err.status;
    title = err.code === 'not_found' ? 'Not Found' : 'Upstream portal error';
    detail = err.message;
  } else {
    log(`unhandled error: ${err?.stack ?? err}`);
  }
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail });
};
