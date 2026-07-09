import { Request, Response, NextFunction } from 'express';
import NodeCache from 'node-cache';
import { logger } from '../utils/logger';
import { sendResponse } from '../utils/helpers';

// Initialize cache with a default TTL of 60 seconds
export const apiCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

/**
 * Middleware to cache GET responses
 * @param duration TTL in seconds (overrides default if provided)
 */
export const cacheMiddleware = (duration?: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Construct a unique cache key based on URL and query params
    // Include user ID if authenticated to prevent cross-user caching of private data
    const userId = (req as any).user?._id?.toString() || 'anonymous';
    const key = `__express__${userId}__${req.originalUrl || req.url}`;

    const cachedResponse = apiCache.get(key);
    if (cachedResponse) {
      logger.debug(`Cache hit for key: ${key}`);
      return sendResponse(res, 200, true, 'Retrieved from cache', cachedResponse as any);
    }

    logger.debug(`Cache miss for key: ${key}`);

    // Intercept res.json to store the response in cache before sending
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      // Only cache successful responses that use the standard sendResponse wrapper (which puts data in body.data)
      if (res.statusCode >= 200 && res.statusCode < 300 && body && body.success && body.data) {
        apiCache.set(key, body.data, duration as number);
      }
      return originalJson(body);
    };

    next();
  };
};

/**
 * Utility to manually invalidate cache (e.g. on profile update)
 */
export const clearCachePrefix = (prefix: string) => {
  const keys = apiCache.keys();
  const toDelete = keys.filter(k => k.includes(prefix));
  if (toDelete.length > 0) {
    apiCache.del(toDelete);
    logger.debug(`Invalidated ${toDelete.length} cache keys matching prefix: ${prefix}`);
  }
};
