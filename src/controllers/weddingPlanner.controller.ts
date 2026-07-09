import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { WeddingPlanner } from '../models/WeddingPlanner';
import { Match } from '../models/Match';
import { sendResponse } from '../utils/helpers';
import { logger } from '../utils/logger';

const DEFAULT_BUDGET_ITEMS = [
  { category: 'hall' as const, name: 'Wedding Venue / Hall Booking', allocatedAmount: 1000000, spentAmount: 0, paidStatus: 'unpaid' as const },
  { category: 'catering' as const, name: 'Catering Services & Menu', allocatedAmount: 1000000, spentAmount: 0, paidStatus: 'unpaid' as const },
  { category: 'photographer' as const, name: 'Photography & Videography', allocatedAmount: 400000, spentAmount: 0, paidStatus: 'unpaid' as const },
  { category: 'decoration' as const, name: 'Flower Decoration & Stage Design', allocatedAmount: 300000, spentAmount: 0, paidStatus: 'unpaid' as const },
];

const DEFAULT_CHECKLIST = [
  { task: 'Select and Book Wedding Hall / Mandapam', completed: false },
  { task: 'Book Catering Service and finalize menu card', completed: false },
  { task: 'Hire photographer and videographer crew', completed: false },
  { task: 'Choose florist and design wedding stage decor theme', completed: false },
  { task: 'Draft guest list (Bride & Groom sides)', completed: false },
  { task: 'Design and print wedding cards', completed: false },
  { task: 'Send wedding invitation card invites', completed: false },
  { task: 'Finalize RSVP guest counts and seating arrangements', completed: false },
];

export class WeddingPlannerController {
  /**
   * GET /api/v1/wedding-planner/:matchId
   * Load or initialize the Wedding Planner dashboard
   */
  static getPlanner = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { matchId } = req.params;
      const myId = req.user?._id;

      if (!myId) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      let planner = await WeddingPlanner.findOne({ matchId });
      
      if (!planner) {
        // Initialize default planner
        const match = await Match.findById(matchId);
        if (!match) {
          return sendResponse(res, 404, false, 'Match record not found.');
        }

        planner = new WeddingPlanner({
          user1: match.user1,
          user2: match.user2,
          matchId: match._id,
          totalBudget: 3000000, // ₹30 Lakhs default
          budgetItems: DEFAULT_BUDGET_ITEMS,
          guests: [],
          vendors: [],
          checklist: DEFAULT_CHECKLIST,
        });

        await planner.save();
        logger.info(`Initialized default Wedding Planner for match: ${matchId}`);
      }

      return sendResponse(res, 200, true, 'Wedding planner loaded.', planner);
    } catch (error: any) {
      logger.error(`getPlanner error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to load wedding planner.');
    }
  };

  /**
   * PUT /api/v1/wedding-planner/:matchId
   * Update full wedding planner configuration
   */
  static updatePlanner = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { matchId } = req.params;
      const myId = req.user?._id;
      const { totalBudget, budgetItems, guests, vendors, checklist, weddingDate } = req.body;

      if (!myId) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const planner = await WeddingPlanner.findOne({ matchId });
      if (!planner) {
        return sendResponse(res, 404, false, 'Wedding planner not initialized.');
      }

      // Update fields if provided in body
      if (totalBudget !== undefined) planner.totalBudget = totalBudget;
      if (budgetItems !== undefined) planner.budgetItems = budgetItems;
      if (guests !== undefined) planner.guests = guests;
      if (vendors !== undefined) planner.vendors = vendors;
      if (checklist !== undefined) planner.checklist = checklist;
      if (weddingDate !== undefined) planner.weddingDate = weddingDate;

      await planner.save();
      logger.info(`Wedding Planner updated for match: ${matchId} by user: ${myId}`);

      return sendResponse(res, 200, true, 'Wedding planner updated successfully.', planner);
    } catch (error: any) {
      logger.error(`updatePlanner error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to update wedding planner.');
    }
  };
}
