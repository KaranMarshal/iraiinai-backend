import http from 'http';
import app from './app';
import { ENV } from './config/env';
import { connectDB } from './config/db';
import { logger } from './utils/logger';
import { SocketService } from './services/socket.service';
import { CampaignScheduler } from './services/campaign.scheduler';

const PORT = parseInt(ENV.PORT, 10);

const startServer = async () => {
  // Connect to Database
  await connectDB();

  const httpServer = http.createServer(app);

  // Initialize Socket.io service
  SocketService.init(httpServer);

  // Initialize Campaign Scheduler Daemon
  CampaignScheduler.start();

  const server = httpServer.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server is running in ${ENV.NODE_ENV} mode on port ${PORT}`);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (err: any) => {
    logger.error(`Unhandled Rejection Error: ${err.message}`);
    // Close server & exit process
    server.close(() => process.exit(1));
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (err: any) => {
    logger.error(`Uncaught Exception: ${err.message}`);
    // Close server & exit process
    server.close(() => process.exit(1));
  });
};

startServer();
