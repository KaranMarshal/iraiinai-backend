import { Router } from 'express';
import { ProfileController } from '../controllers/profile.controller';
import { authenticateUser } from '../middleware/auth.middleware';
import { cacheMiddleware } from '../middleware/cache.middleware';

const router = Router();

// Load current profile
router.get('/', authenticateUser as any, cacheMiddleware(30) as any, ProfileController.getMyProfile as any);

// Save current profile (supports both POST / and POST /create)
router.post('/', authenticateUser as any, ProfileController.createOrUpdateProfile as any);
router.post('/create', authenticateUser as any, ProfileController.createOrUpdateProfile as any);

// Load current profile by alias /me, and support drafts
router.get('/me', authenticateUser as any, cacheMiddleware(30) as any, ProfileController.getMyProfile as any);
router.patch('/draft', authenticateUser as any, ProfileController.saveDraft as any);
router.get('/dashboard', authenticateUser as any, cacheMiddleware(60) as any, ProfileController.getDashboardData as any);
router.post('/boost/activate', authenticateUser as any, ProfileController.activateBoost as any);

// Fetch incoming pending requests (needs to be registered before :id route so it doesn't match as an ID!)
router.get('/photo-requests/pending', authenticateUser as any, ProfileController.getPendingRequests as any);

// Photo upload and settings
router.post('/photos', authenticateUser as any, ProfileController.uploadPhoto as any);
router.post('/photos/batch', authenticateUser as any, ProfileController.uploadPhotosBatch as any);
router.post('/photos/upload-raw', authenticateUser as any, ProfileController.uploadRawPhoto as any);
router.post('/photos/upload-raw-batch', authenticateUser as any, ProfileController.uploadRawPhotosBatch as any);
router.delete('/photos', authenticateUser as any, ProfileController.deletePhoto as any);
router.put('/photos/primary', authenticateUser as any, ProfileController.setPrimaryPhoto as any);
router.patch('/photo-privacy', authenticateUser as any, ProfileController.updatePhotoPrivacy as any);

// Video and Voice introductions
router.get('/media-upload-url', authenticateUser as any, ProfileController.getMediaUploadUrl as any);
router.post('/media-intro', authenticateUser as any, ProfileController.updateMediaIntro as any);
router.post('/media-upload-local', authenticateUser as any, ProfileController.uploadMediaLocal as any);
router.post('/verify-id', authenticateUser as any, ProfileController.submitIdVerification as any);
router.post('/nl-search', authenticateUser as any, ProfileController.nlSearch as any);

// Photo access requests
router.post('/photo-request/:profileId', authenticateUser as any, ProfileController.requestPhotoAccess as any);
router.post('/photo-request/:requestId/respond', authenticateUser as any, ProfileController.respondToPhotoRequest as any);

// Search profiles using advanced filters
router.post('/search', authenticateUser as any, ProfileController.searchProfiles as any);

// Fetch other user's profile
router.post('/unlock-contact/:id', authenticateUser as any, ProfileController.unlockContact as any);
router.get('/:id', authenticateUser as any, ProfileController.getProfileById as any);

export default router;
