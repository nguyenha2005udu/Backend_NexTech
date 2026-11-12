import type { NextFunction, Request, Response } from 'express';
import { GW_ERROR, sendError } from '../errors';
import { matchRoute } from '../routes';

// Tra bảng route. Lưu ở req.gatewayRoute (req.route đã bị Express dành).
// Không có route — kể cả /internal/* — thì 404, request không tới service nào.
export function resolveRoute(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const route = matchRoute(req.method, req.originalUrl);
  if (!route) return sendError(req, res, GW_ERROR.NOT_FOUND);
  req.gatewayRoute = route;
  next();
}
