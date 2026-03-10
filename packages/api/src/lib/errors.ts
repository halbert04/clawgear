import { HTTPException } from 'hono/http-exception';

export function notFound(entity: string, id: string): HTTPException {
  return new HTTPException(404, { message: `${entity} not found: ${id}` });
}

export function badRequest(message: string): HTTPException {
  return new HTTPException(400, { message });
}

export function conflict(message: string): HTTPException {
  return new HTTPException(409, { message });
}
