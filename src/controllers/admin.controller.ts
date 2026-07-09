import { Request, Response } from 'express';
import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { Match } from '../models/Match';
import { Transaction } from '../models/Transaction';

export class AdminController {
  /**
   * Get high-level system statistics for the dashboard.
   */
  static async getDashboardStats(req: Request, res: Response) {
    try {
      const totalUsers = await User.countDocuments();
      const activeUsers = await User.countDocuments({ status: 'active' });
      const suspendedUsers = await User.countDocuments({ status: 'suspended' });
      
      const premiumUsers = await User.countDocuments({ 'subscription.status': 'active' });
      
      const totalMatches = await Match.countDocuments({ status: 'matched' });
      
      const revenueDocs = await Transaction.aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: null, totalRevenue: { $sum: '$amount' } } }
      ]);
      const totalRevenue = revenueDocs.length > 0 ? revenueDocs[0].totalRevenue : 0;

      // Dummy chart data for "Signups over last 6 months" for the frontend charting
      const signupChartData = [
        { month: 'Jan', signups: Math.floor(totalUsers * 0.1) },
        { month: 'Feb', signups: Math.floor(totalUsers * 0.15) },
        { month: 'Mar', signups: Math.floor(totalUsers * 0.2) },
        { month: 'Apr', signups: Math.floor(totalUsers * 0.25) },
        { month: 'May', signups: Math.floor(totalUsers * 0.1) },
        { month: 'Jun', signups: Math.floor(totalUsers * 0.2) },
      ];

      res.status(200).json({
        success: true,
        data: {
          totalUsers,
          activeUsers,
          suspendedUsers,
          premiumUsers,
          totalMatches,
          totalRevenue,
          signupChartData,
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Get all users (paginated) for the management console.
   */
  static async getAllUsers(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const users = await User.find()
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean();

      // Attach profile name if available
      const populatedUsers = await Promise.all(users.map(async (u) => {
        const profile = await Profile.findOne({ user: u._id }).select('name gender isVerified idProofUrl idProofType verificationStatus');
        return {
          ...u,
          profileName: profile?.name || 'Incomplete Profile',
          gender: profile?.gender || 'N/A',
          isVerified: profile?.isVerified || false,
          idProofUrl: profile?.idProofUrl || '',
          idProofType: profile?.idProofType || '',
          verificationStatus: profile?.verificationStatus || 'none',
        };
      }));

      const total = await User.countDocuments();

      res.status(200).json({
        success: true,
        data: {
          users: populatedUsers,
          pagination: {
            total,
            page,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Suspend or Activate a user
   */
  static async updateUserStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { status } = req.body; // 'active', 'suspended', 'banned'

      if (!['active', 'suspended', 'banned'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status type' });
      }

      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      (user as any).status = status;
      await user.save();

      res.status(200).json({
        success: true,
        message: `User status updated to ${status}`,
        data: user
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Verify a user's profile
   */
  static async verifyUserProfile(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const profile = await Profile.findOne({ user: id });
      
      if (!profile) {
        return res.status(404).json({ success: false, message: 'Profile not found' });
      }

      profile.isVerified = true;
      profile.verificationStatus = 'approved';
      await profile.save();

      res.status(200).json({
        success: true,
        message: 'Profile verified successfully',
        data: profile
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Get user activity monitoring data
   */
  static async getUserActivity(req: Request, res: Response) {
    try {
      const { id } = req.params;
      
      const user = await User.findById(id).select('-password');
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const matchCount = await Match.countDocuments({
        $or: [{ user1: id }, { user2: id }]
      });

      const transactions = await Transaction.find({ user: id })
        .sort({ createdAt: -1 })
        .limit(5);

      res.status(200).json({
        success: true,
        data: {
          user,
          stats: {
            totalMatches: matchCount,
          },
          recentTransactions: transactions
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Reject a user profile's identity verification request.
   */
  static async rejectUserProfileVerification(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const profile = await Profile.findOne({ user: id });
      
      if (!profile) {
        return res.status(404).json({ success: false, message: 'Profile not found' });
      }

      profile.isVerified = false;
      profile.verificationStatus = 'rejected';
      await profile.save();

      res.status(200).json({
        success: true,
        message: 'Profile verification request rejected successfully',
        data: profile
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}
