import { Router } from 'express';
import { QuizController } from '../controllers/quiz.controller';
import { authenticateUser } from '../middleware/auth.middleware';

const router = Router();

// Middleware: Require user authentication for all quiz endpoints
router.use(authenticateUser as any);

router.get('/questions', QuizController.getQuestions as any);
router.post('/answers', QuizController.saveAnswers as any);
router.get('/answers/me', QuizController.getMyAnswers as any);
router.get('/report/:targetUserId', QuizController.getQuizReport as any);

export default router;
