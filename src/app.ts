import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import path from 'path';
import fs from 'fs';
import { ENV } from './config/env';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/error.middleware';
import apiRouter from './routes';

const app: Application = express();

// Performance Optimization
app.use(compression());

// CORS – allow web origins + mobile native apps (which send no Origin header)
const allowedOrigins = [
  'https://iraiinai.com',
  'https://www.iraiinai.com',
  'https://admin.iraiinai.com',
  'http://localhost:3000',
  'http://localhost:19006', // Expo web
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (React Native mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (ENV.NODE_ENV !== 'production') return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
}));

// HTTP Strict Transport Security (HSTS) via Helmet
app.use(helmet({
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  }
}));

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes'
});
app.use('/api/', apiLimiter);

// Prevent NoSQL Injection
app.use(mongoSanitize());

// Prevent HTTP Parameter Pollution
app.use(hpp());

// Request logs
const morganStream = {
  write: (message: string) => logger.info(message.trim()),
};
app.use(morgan(ENV.NODE_ENV === 'development' ? 'dev' : 'combined', { stream: morganStream }));

// JSON / Urlencoded parsers
app.use(express.json({
  limit: '10mb',
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Root Route / Health Check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    env: ENV.NODE_ENV
  });
});

// Create uploads folder if not exists (for local file upload fallback)
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded files statically
app.use('/uploads', express.static(uploadsDir));

// Bind API routes
app.use('/api/v1', apiRouter);

// Global Error Handler
app.use(errorHandler);

export default app;
