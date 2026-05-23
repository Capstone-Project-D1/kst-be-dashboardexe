import type { Response } from "express";

export function ok<T>(res: Response, response: T, status = 200) {
  return res.status(status).json({
    timestamp: new Date().toISOString(),
    response,
  });
}

export function fail(res: Response, code: number, message: string) {
  return res.status(code).json({
    timestamp: new Date().toISOString(),
    response: null,
    error: { code, message },
  });
}

export class AppError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}
