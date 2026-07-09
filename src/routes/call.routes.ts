import { Router } from 'express';
import { CallController } from '../controllers/call.controller';
import { authenticateUser } from '../middleware/auth.middleware';

const router = Router();

// All call routes require authentication
router.use(authenticateUser);

// Generate Agora token for a call
router.post('/token', CallController.generateToken);

// Update call status when call ends
router.patch('/:callLogId/end', CallController.endCall);

// Get call history for a match
router.get('/history', CallController.getCallHistory);

export default router;
