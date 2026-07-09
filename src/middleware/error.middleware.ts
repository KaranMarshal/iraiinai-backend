import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { sendResponse } from '../utils/helpers';

export interface CustomError extends Error {
  statusCode?: number;
  errors?: any[];
}

export const errorHandler = (
  err: CustomError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  
  logger.error(`[${req.method}] ${req.originalUrl} - Status: ${statusCode} - Error: ${message}`);
  
  if (err.stack) {
    logger.debug(err.stack);
  }

  // Format and send the response
  return sendResponse(
    res,
    statusCode,
    false,
    message,
    err.errors || null
  );
};
