import { NextFunction, Request, Response } from "express";

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "Endpoint tidak ditemukan" });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const message = err instanceof Error ? err.message : "Terjadi kesalahan internal";
  console.error(err);
  res.status(500).json({ error: message });
}
