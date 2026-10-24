import type { NextFunction, Request, Response } from 'express';
import type { Metrics } from './metrics';

/**
 * Times every request. The route label is the matched route pattern (/api/v1/runs/:id), never
 * the raw URL, so ids and search terms do not become label values.
 */
export function httpMetrics(metrics: Metrics) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const end = metrics.httpDuration.startTimer();
    res.on('finish', () => {
      const route = req.route ? `${req.baseUrl}${String(req.route.path)}` : 'unmatched';
      end({ method: req.method, route, status: String(res.statusCode) });
    });
    next();
  };
}
