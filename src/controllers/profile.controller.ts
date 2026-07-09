import { Response } from 'express';
import fs from 'fs';
import path from 'path';

import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { Profile } from '../models/Profile';
import { ProfileDraft } from '../models/ProfileDraft';
import { PhotoAccessRequest } from '../models/PhotoAccessRequest';
import { Match } from '../models/Match';
import { AIService } from '../services/ai.service';
import { processAndUploadPhoto, getImageUrl, processAndUploadPhotos } from '../utils/photoProcessor';
import { sendResponse } from '../utils/helpers';
import { logger } from '../utils/logger';
import { User } from '../models/User';
import { clearCachePrefix } from '../middleware/cache.middleware';
import { Horoscope } from '../models/Horoscope';
import { calculateProfileCompletion } from '../utils/profileCompletion';
import { MatchmakingService } from '../services/matchmaking.service';
import mongoose from 'mongoose';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ENV } from '../config/env';

// Initialize Gemini SDK if API key is provided
let genAI: GoogleGenerativeAI | null = null;
if (ENV.GEMINI_API_KEY && ENV.GEMINI_API_KEY !== 'YourGeminiApiKeyHere') {
  genAI = new GoogleGenerativeAI(ENV.GEMINI_API_KEY);
}

const parseIncomeToNumeric = (incomeStr: string): number => {
  if (!incomeStr || incomeStr === 'Not Specified' || incomeStr === '—') return 0;
  if (incomeStr.includes('Crore')) return 10000000;
  if (incomeStr.includes('Below')) return 50000;
  const matches = incomeStr.match(/\d+/g);
  if (matches && matches.length > 0) {
    const lower = parseInt(matches[0]);
    return lower * 100000;
  }
  return 0;
};

const escapeRegExp = (string: string): string => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Secures a profile's photos, video, and voice intros depending on privacy settings.
 * Generates temporary signed URLs for authorized viewers.
 */
export const secureProfileMedia = async (
  profile: any,
  reqUser: any
): Promise<any> => {
  if (!profile) return null;
  const profileObj = typeof profile.toObject === 'function' ? profile.toObject() : profile;

  // Load target user's subscription details to populate premium status/badge
  const targetUser = await User.findById(profileObj.user);
  profileObj.isPremium = targetUser?.subscription?.status === 'active' && ['gold', 'platinum'].includes(targetUser?.subscription?.plan);

  const isOwner = reqUser && profileObj.user.toString() === reqUser._id.toString();
  
  // Check if there is a mutual match
  const match = await Match.findOne({
    $or: [
      { user1: reqUser?._id, user2: profileObj.user, status: 'matched' },
      { user1: profileObj.user, user2: reqUser?._id, status: 'matched' }
    ]
  });
  const isMatched = !!match;

  // Check if contact is unlocked
  const isContactUnlocked = isOwner || 
    (reqUser && reqUser.unlockedContacts?.some((id: any) => id.toString() === profileObj.user.toString())) ||
    isMatched;

  if (isContactUnlocked) {
    profileObj.contactDetails = {
      email: targetUser?.email || 'N/A',
      phone: targetUser?.phone || 'N/A',
      isUnlocked: true
    };
  } else {
    // Mask email and phone
    const rawEmail = targetUser?.email || '';
    const rawPhone = targetUser?.phone || '';

    const maskEmail = (email: string) => {
      const [local, domain] = email.split('@');
      if (!domain) return '***';
      if (local.length <= 2) return `${local.substring(0, 1)}***@${domain}`;
      return `${local.substring(0, 2)}***@${domain}`;
    };

    const maskPhone = (phone: string) => {
      if (!phone) return 'N/A';
      if (phone.length <= 6) return `${phone.substring(0, 2)}******`;
      return `${phone.substring(0, 4)}******${phone.substring(phone.length - 2)}`;
    };

    profileObj.contactDetails = {
      email: rawEmail ? maskEmail(rawEmail) : 'N/A',
      phone: rawPhone ? maskPhone(rawPhone) : 'N/A',
      isUnlocked: false
    };
  }

  if (isOwner) {
    if (profileObj.photos && profileObj.photos.length > 0) {
      profileObj.photos = await Promise.all(profileObj.photos.map((p: string) => getImageUrl(p)));
    }
    if (profileObj.videoIntroUrl) {
      profileObj.videoIntroUrl = await getImageUrl(profileObj.videoIntroUrl);
    }
    if (profileObj.voiceIntroUrl) {
      profileObj.voiceIntroUrl = await getImageUrl(profileObj.voiceIntroUrl);
    }
    profileObj.photosLocked = false;
    profileObj.photoRequestStatus = 'approved';
    
    profileObj.videoIntroLocked = false;
    profileObj.voiceIntroLocked = false;
    
    return profileObj;
  }

  const isPremium = reqUser?.subscription?.status === 'active';

  const isApproved = profileObj.photoAccessGrants?.some(
    (id: any) => id.toString() === reqUser?._id.toString()
  );

  // 1. Process Photos
  let photosLocked = false;
  if (profileObj.photoPrivacy === 'hidden') {
    photosLocked = true;
  } else if (profileObj.photoPrivacy === 'request_only' && !isMatched && !isApproved) {
    photosLocked = true;
  } else if (profileObj.photoPrivacy === 'visible_to_premium' && !isPremium && !isMatched && !isApproved) {
    photosLocked = true;
  }

  if (photosLocked) {
    profileObj.photos = [];
    profileObj.photosLocked = true;

    // Check if the user has a pending request
    const pendingRequest = await PhotoAccessRequest.findOne({
      requester: reqUser?._id,
      recipient: profileObj.user,
      status: 'pending'
    });
    profileObj.photoRequestStatus = pendingRequest ? 'pending' : 'none';
  } else {
    profileObj.photosLocked = false;
    profileObj.photoRequestStatus = 'approved';
    if (profileObj.photos && profileObj.photos.length > 0) {
      profileObj.photos = await Promise.all(profileObj.photos.map((p: string) => getImageUrl(p)));
    }
  }

  // 2. Process Video Introduction
  let videoLocked = false;
  if (profileObj.videoIntroUrl) {
    if (profileObj.videoIntroPrivacy === 'hidden') {
      videoLocked = true;
    } else if (profileObj.videoIntroPrivacy === 'request_only' && !isMatched && !isApproved) {
      videoLocked = true;
    } else if (profileObj.videoIntroPrivacy === 'visible_to_premium' && !isPremium && !isMatched && !isApproved) {
      videoLocked = true;
    }

    if (videoLocked) {
      profileObj.videoIntroUrl = '';
      profileObj.videoIntroLocked = true;
    } else {
      profileObj.videoIntroLocked = false;
      profileObj.videoIntroUrl = await getImageUrl(profileObj.videoIntroUrl);
    }
  }

  // 3. Process Voice Introduction
  let voiceLocked = false;
  if (profileObj.voiceIntroUrl) {
    if (profileObj.voiceIntroPrivacy === 'hidden') {
      voiceLocked = true;
    } else if (profileObj.voiceIntroPrivacy === 'request_only' && !isMatched && !isApproved) {
      voiceLocked = true;
    } else if (profileObj.voiceIntroPrivacy === 'visible_to_premium' && !isPremium && !isMatched && !isApproved) {
      voiceLocked = true;
    }

    if (voiceLocked) {
      profileObj.voiceIntroUrl = '';
      profileObj.voiceIntroLocked = true;
    } else {
      profileObj.voiceIntroLocked = false;
      profileObj.voiceIntroUrl = await getImageUrl(profileObj.voiceIntroUrl);
    }
  }

  return profileObj;
};

/**
 * Legacy wrapper function for compatibility
 */
export const secureProfilePhotos = async (
  profile: any,
  reqUser: any
): Promise<any> => {
  return secureProfileMedia(profile, reqUser);
};

export class ProfileController {
  /**
   * Fetch current user's profile details
   */
  static getMyProfile = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const profile = await Profile.findOne({ user: req.user?._id });
      if (!profile) {
        return sendResponse(res, 404, false, 'Matrimony profile does not exist yet.');
      }
      const securedProfile = await secureProfilePhotos(profile, req.user);
      const completion = calculateProfileCompletion(profile, req.user);
      securedProfile.completion = completion;
      return sendResponse(res, 200, true, 'Profile loaded successfully.', securedProfile);
    } catch (error: any) {
      logger.error(`getMyProfile error: ${error.message}`);
      return sendResponse(res, 500, false, 'Error fetching profile.');
    }
  };

  /**
   * Create or update current user's profile details
   */
  static createOrUpdateProfile = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        name,
        gender,
        dob,
        age,
        maritalStatus,
        religion,
        caste,
        community,
        motherTongue,
        occupation,
        income,
        location,
        bio,
        interests,
        familyDetails,
        preferences,
        education,
        career,
      } = req.body;

      if (!name || !gender || !dob || !location) {
        return sendResponse(res, 400, false, 'Missing mandatory fields: name, gender, dob, location.');
      }

      // Check if profile exists
      let profile = await Profile.findOne({ user: req.user?._id });

      // Compute age from dob if not provided in payload
      const dobDate = new Date(dob);
      const computedAge = Math.floor((Date.now() - dobDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      const finalAge = age || computedAge;

      const profilePayload = {
        user: req.user?._id,
        name,
        gender,
        dob: dobDate,
        age: finalAge,
        maritalStatus,
        religion,
        caste,
        community: community || caste,
        motherTongue,
        occupation: occupation || (career && career.occupation),
        income: income || (career && career.annualIncome ? parseIncomeToNumeric(career.annualIncome) : undefined),
        location,
        bio,
        interests: interests || [],
        education: education || undefined,
        career: career || undefined,
        familyDetails: familyDetails || undefined,
        preferences: preferences || {
          ageRange: { min: 21, max: 35 },
          religions: [],
          locations: [],
        },
      };

      // Trigger Gemini summarization for the profile
      const aiSummary = await AIService.generateProfileSummary(profilePayload);

      if (profile) {
        // Update
        profile = await Profile.findOneAndUpdate(
          { user: req.user?._id },
          { ...profilePayload, aiSummary },
          { new: true, runValidators: true }
        );
        logger.info(`Profile updated for user: ${req.user?._id}`);
      } else {
        // Create
        profile = await Profile.create({ ...profilePayload, aiSummary });
        logger.info(`Profile created for user: ${req.user?._id}`);
      }

      // Invalidate the cache for this user
      if (req.user) {
        clearCachePrefix(`__express__${req.user._id}`);
      }

      const securedProfile = await secureProfilePhotos(profile, req.user);
      const completion = calculateProfileCompletion(profile, req.user);
      securedProfile.completion = completion;
      return sendResponse(res, 200, true, 'Profile saved successfully.', securedProfile);
    } catch (error: any) {
      logger.error(`createOrUpdateProfile error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to save profile.', error.message);
    }
  };

  /**
   * Fetch specific profile by ID
   */
  static getProfileById = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const profile = await Profile.findById(req.params.id);
      if (!profile) {
        return sendResponse(res, 404, false, 'Profile not found.');
      }

      // Trigger Profile View Notification
      if (req.user && profile.user.toString() !== req.user._id.toString()) {
        const { Notification } = require('../models/Notification');
        const viewerProfile = await Profile.findOne({ user: req.user._id });
        const viewerName = viewerProfile?.name || 'Someone';

        Notification.create({
          recipient: profile.user,
          sender: req.user._id,
          type: 'profile_view',
          title: 'Profile Viewed',
          body: `${viewerName} viewed your profile.`,
          dataPayload: new Map([['type', 'profile_view']]),
          isRead: false,
        }).catch((nErr: any) => {
          logger.error(`Failed to create profile view notification: ${nErr.message}`);
        });
      }

      const userRecord = await User.findOne({ _id: profile.user });
      const securedProfile = await secureProfilePhotos(profile, req.user);
      const completion = calculateProfileCompletion(profile, userRecord);
      securedProfile.completion = completion;
      return sendResponse(res, 200, true, 'Profile loaded.', securedProfile);
    } catch (error: any) {
      logger.error(`getProfileById error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to load profile details.');
    }
  };

  /**
   * Save profile draft progress
   */
  static saveDraft = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user?._id) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      // Perform a merge update by converting req.body into stepData.key dot-notation paths
      const updateData: any = {};
      Object.keys(req.body).forEach((key) => {
        updateData[`stepData.${key}`] = req.body[key];
      });

      const draft = await ProfileDraft.findOneAndUpdate(
        { user: req.user._id },
        { $set: updateData },
        { upsert: true, new: true }
      );

      logger.info(`Profile draft saved for user: ${req.user._id}`);
      return sendResponse(res, 200, true, 'Profile draft saved successfully.', draft);
    } catch (error: any) {
      logger.error(`saveDraft error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to save profile draft.');
    }
  };

  /**
   * Upload a base64 photo
   */
  static uploadPhoto = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { photoBase64 } = req.body;
      if (!photoBase64) {
        return sendResponse(res, 400, false, 'Photo base64 content is required.');
      }

      let profile = await Profile.findOne({ user: req.user?._id });
      if (!profile) {
        return sendResponse(res, 404, false, 'Profile not found. Create profile first.');
      }

      if (profile.photos.length >= 5) {
        return sendResponse(res, 400, false, 'Maximum of 5 photos allowed.');
      }

      const host = req.get('host') || 'localhost:5000';
      const photoUrl = await processAndUploadPhoto(req.user!._id.toString(), photoBase64, host);

      profile.photos.push(photoUrl);
      await profile.save();

      return sendResponse(res, 200, true, 'Photo uploaded successfully.', {
        photos: profile.photos
      });
    } catch (error: any) {
      logger.error(`uploadPhoto error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to upload photo.', error.message);
    }
  };

  /**
   * Delete a photo by URL
   */
  static deletePhoto = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { photoUrl } = req.body;
      if (!photoUrl) {
        return sendResponse(res, 400, false, 'Photo URL is required.');
      }

      let profile = await Profile.findOne({ user: req.user?._id });
      if (!profile) {
        return sendResponse(res, 404, false, 'Profile not found.');
      }

      profile.photos = profile.photos.filter((url) => url !== photoUrl);
      await profile.save();

      return sendResponse(res, 200, true, 'Photo deleted successfully.', {
        photos: profile.photos
      });
    } catch (error: any) {
      logger.error(`deletePhoto error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to delete photo.');
    }
  };

  /**
   * Set a photo as the primary profile photo (moves to index 0)
   */
  static setPrimaryPhoto = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { photoUrl } = req.body;
      if (!photoUrl) {
        return sendResponse(res, 400, false, 'Photo URL is required.');
      }

      let profile = await Profile.findOne({ user: req.user?._id });
      if (!profile) {
        return sendResponse(res, 404, false, 'Profile not found.');
      }

      if (!profile.photos.includes(photoUrl)) {
        return sendResponse(res, 400, false, 'Photo is not associated with this profile.');
      }

      profile.photos = [photoUrl, ...profile.photos.filter((url) => url !== photoUrl)];
      await profile.save();

      return sendResponse(res, 200, true, 'Primary photo updated successfully.', {
        photos: profile.photos
      });
    } catch (error: any) {
      logger.error(`setPrimaryPhoto error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to set primary photo.');
    }
  };

  /**
   * Update photo privacy settings
   */
  static updatePhotoPrivacy = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { privacy } = req.body;
      const validPrivacy = ['visible_to_all', 'visible_to_premium', 'request_only', 'hidden'];
      if (!validPrivacy.includes(privacy)) {
        return sendResponse(res, 400, false, 'Invalid photo privacy level.');
      }

      const profile = await Profile.findOneAndUpdate(
        { user: req.user?._id },
        { photoPrivacy: privacy },
        { new: true }
      );

      if (!profile) {
        return sendResponse(res, 404, false, 'Profile not found.');
      }

      return sendResponse(res, 200, true, 'Photo privacy updated successfully.', {
        photoPrivacy: profile.photoPrivacy
      });
    } catch (error: any) {
      logger.error(`updatePhotoPrivacy error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to update photo privacy.');
    }
  };

  /**
   * Request photo access to another profile
   */
  static requestPhotoAccess = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const targetProfile = await Profile.findById(req.params.profileId);
      if (!targetProfile) {
        return sendResponse(res, 404, false, 'Target profile not found.');
      }

      if (targetProfile.user.toString() === req.user?._id.toString()) {
        return sendResponse(res, 400, false, 'You cannot request photo access to your own profile.');
      }

      const accessRequest = await PhotoAccessRequest.findOneAndUpdate(
        { requester: req.user?._id, recipient: targetProfile.user },
        { status: 'pending' },
        { upsert: true, new: true }
      );

      logger.info(`Photo access request created by ${req.user?._id} to ${targetProfile.user}`);

      return sendResponse(res, 200, true, 'Photo access requested successfully.', accessRequest);
    } catch (error: any) {
      logger.error(`requestPhotoAccess error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to request photo access.');
    }
  };

  /**
   * Respond to a photo request (Approve / Reject)
   */
  static respondToPhotoRequest = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { action } = req.body;
      if (action !== 'approve' && action !== 'reject') {
        return sendResponse(res, 400, false, 'Action must be either "approve" or "reject".');
      }

      const accessRequest = await PhotoAccessRequest.findById(req.params.requestId);
      if (!accessRequest) {
        return sendResponse(res, 404, false, 'Photo access request not found.');
      }

      if (accessRequest.recipient.toString() !== req.user?._id.toString()) {
        return sendResponse(res, 403, false, 'Unauthorized to respond to this request.');
      }

      accessRequest.status = action === 'approve' ? 'approved' : 'rejected';
      await accessRequest.save();

      if (action === 'approve') {
        await Profile.findOneAndUpdate(
          { user: req.user?._id },
          { $addToSet: { photoAccessGrants: accessRequest.requester } }
        );
      }

      return sendResponse(res, 200, true, `Photo access request ${action}d successfully.`, accessRequest);
    } catch (error: any) {
      logger.error(`respondToPhotoRequest error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to respond to photo request.');
    }
  };

  /**
   * Fetch incoming pending photo requests
   */
  static getPendingRequests = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const requests = await PhotoAccessRequest.find({
        recipient: req.user?._id,
        status: 'pending'
      }).populate('requester', 'email phone');

      const requestsWithNames = await Promise.all(
        requests.map(async (r: any) => {
          const profile = await Profile.findOne({ user: r.requester._id }, 'name');
          const obj = r.toObject();
          obj.requesterName = profile?.name || 'Unknown User';
          return obj;
        })
      );

      return sendResponse(res, 200, true, 'Pending photo requests loaded.', requestsWithNames);
    } catch (error: any) {
      logger.error(`getPendingRequests error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to fetch pending requests.');
    }
  };

  /**
   * Upload a raw base64 photo (used during onboarding before profile creation)
   */
  static uploadRawPhoto = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { photoBase64 } = req.body;
      if (!photoBase64) {
        return sendResponse(res, 400, false, 'Photo base64 content is required.');
      }

      const host = req.get('host') || 'localhost:5000';
      const photoUrl = await processAndUploadPhoto(
        req.user?._id.toString() || 'temp',
        photoBase64,
        host
      );

      return sendResponse(res, 200, true, 'Photo uploaded successfully.', {
        photoUrl
      });
    } catch (error: any) {
      logger.error(`uploadRawPhoto error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to upload photo.', error.message);
    }
  };

  /**
   * Upload multiple base64 photos in batch
   */
  static uploadPhotosBatch = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { photosBase64 } = req.body;
      if (!photosBase64 || !Array.isArray(photosBase64) || photosBase64.length === 0) {
        return sendResponse(res, 400, false, 'Photos base64 array is required.');
      }

      let profile = await Profile.findOne({ user: req.user?._id });
      if (!profile) {
        return sendResponse(res, 404, false, 'Profile not found. Create profile first.');
      }

      if (profile.photos.length + photosBase64.length > 5) {
        return sendResponse(res, 400, false, `Cannot upload ${photosBase64.length} photos. Maximum of 5 photos allowed. Currently you have ${profile.photos.length}.`);
      }

      const host = req.get('host') || 'localhost:5000';
      const uploadedUrls = await processAndUploadPhotos(req.user!._id.toString(), photosBase64, host);

      profile.photos.push(...uploadedUrls);
      await profile.save();

      const securedProfile = await secureProfilePhotos(profile, req.user);

      return sendResponse(res, 200, true, 'Photos uploaded successfully.', {
        photos: securedProfile.photos
      });
    } catch (error: any) {
      logger.error(`uploadPhotosBatch error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to upload photos in batch.', error.message);
    }
  };

  /**
   * Upload multiple raw base64 photos in batch (onboarding)
   */
  static uploadRawPhotosBatch = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { photosBase64 } = req.body;
      if (!photosBase64 || !Array.isArray(photosBase64) || photosBase64.length === 0) {
        return sendResponse(res, 400, false, 'Photos base64 array is required.');
      }

      const host = req.get('host') || 'localhost:5000';
      const uploadedUrls = await processAndUploadPhotos(
        req.user?._id.toString() || 'temp',
        photosBase64,
        host
      );

      const securedUrls = await Promise.all(uploadedUrls.map((url) => getImageUrl(url)));

      return sendResponse(res, 200, true, 'Photos uploaded successfully.', {
        photoUrls: securedUrls
      });
    } catch (error: any) {
      logger.error(`uploadRawPhotosBatch error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to upload photos in batch.', error.message);
    }
  };

  /**
   * Generates a signed upload URL for video/voice introductions (Firebase)
   * or returns a local fallback endpoint if Firebase is mocked.
   */
  static getMediaUploadUrl = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { type } = req.query;
      if (type !== 'video' && type !== 'voice') {
        return sendResponse(res, 400, false, 'Invalid media type. Must be "video" or "voice".');
      }

      const userId = req.user!._id.toString();
      const extension = type === 'video' ? 'mp4' : 'm4a';
      const contentType = type === 'video' ? 'video/mp4' : 'audio/x-m4a';
      const filename = `${type}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${extension}`;
      const host = req.get('host') || 'localhost:5000';



      // Local fallback configuration
      const localUploadUrl = `http://${host}/api/v1/profile/media-upload-local`;
      const finalUrlPlaceholder = `http://${host}/uploads/${filename}`;

      return sendResponse(res, 200, true, 'Local upload configuration returned.', {
        uploadUrl: localUploadUrl,
        finalUrl: finalUrlPlaceholder,
        isLocal: true,
        filename,
        contentType
      });
    } catch (error: any) {
      logger.error(`getMediaUploadUrl error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to generate media upload URL.');
    }
  };

  /**
   * Save uploaded introduction media link (updates profile fields)
   */
  static updateMediaIntro = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { type, mediaUrl, privacy } = req.body;
      if (type !== 'video' && type !== 'voice') {
        return sendResponse(res, 400, false, 'Invalid type. Must be "video" or "voice".');
      }
      if (!mediaUrl) {
        return sendResponse(res, 400, false, 'mediaUrl is required.');
      }

      const updateFields: any = {};
      if (type === 'video') {
        updateFields.videoIntroUrl = mediaUrl;
        if (privacy) updateFields.videoIntroPrivacy = privacy;
      } else {
        updateFields.voiceIntroUrl = mediaUrl;
        if (privacy) updateFields.voiceIntroPrivacy = privacy;
      }

      const profile = await Profile.findOneAndUpdate(
        { user: req.user?._id },
        updateFields,
        { new: true }
      );

      if (!profile) {
        return sendResponse(res, 404, false, 'Profile not found.');
      }

      const securedProfile = await secureProfileMedia(profile, req.user);

      return sendResponse(res, 200, true, 'Media introduction updated.', securedProfile);
    } catch (error: any) {
      logger.error(`updateMediaIntro error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to update media introduction.');
    }
  };

  /**
   * Helper endpoint for saving local mock uploads in development (when Firebase is disabled)
   */
  static uploadMediaLocal = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { filename, base64 } = req.body;
      if (!filename || !base64) {
        return sendResponse(res, 400, false, 'filename and base64 string are required.');
      }

      const uploadsDir = path.join(__dirname, '../../uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const base64Data = base64.replace(/^data:.*?;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const filePath = path.join(uploadsDir, filename);

      fs.writeFileSync(filePath, buffer);
      logger.info(`Local media file saved: ${filePath}`);

      return sendResponse(res, 200, true, 'Local media saved successfully.');
    } catch (error: any) {
      logger.error(`uploadMediaLocal error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to save local media.');
    }
  };

  /**
   * Advanced search and filtering system for profiles
   */
  static searchProfiles = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const {
        religion,
        caste,
        minIncome,
        maxIncome,
        occupation,
        location,
        horoscope,
        premiumOptions
      } = req.body;

      // 1. Fetch searcher profile to get opposite gender
      const myProfile = await Profile.findOne({ user: req.user._id });
      if (!myProfile) {
        return sendResponse(res, 400, false, 'Please create a profile first to search.');
      }

      const targetGender = myProfile.gender === 'male' ? 'female' : 'male';

      // 2. Validate premium search status
      const hasPremiumFiltersApplied = !!(
        caste ||
        (horoscope && Object.keys(horoscope).length > 0) ||
        (premiumOptions && Object.keys(premiumOptions).length > 0)
      );

      const isPremiumUser = req.user.subscription?.status === 'active' &&
                            ['gold', 'platinum'].includes(req.user.subscription?.plan);

      const premiumUpgradeRequired = hasPremiumFiltersApplied && !isPremiumUser;
      
      // Limit search results: free accounts using premium filters are limited to 2 results as a preview
      const limit = premiumUpgradeRequired ? 2 : 20;

      // 3. Build mongoose profile query
      const query: any = {
        user: { $ne: req.user._id },
        gender: targetGender
      };

      // Basic filters: Religion
      if (religion) {
        const religions = Array.isArray(religion) ? religion : [religion];
        if (religions.length > 0) {
          query.religion = { $in: religions.map(r => new RegExp('^' + escapeRegExp(r.trim()) + '$', 'i')) };
        }
      }

      // Caste (premium filter)
      if (caste) {
        const castes = Array.isArray(caste) ? caste : [caste];
        if (castes.length > 0) {
          const casteRegexes = castes.map(c => new RegExp('^' + escapeRegExp(c.trim()) + '$', 'i'));
          query.$or = [
            { caste: { $in: casteRegexes } },
            { community: { $in: casteRegexes } }
          ];
        }
      }

      // Basic filters: Location (City, State)
      if (location) {
        if (location.city) {
          const cities = Array.isArray(location.city) ? location.city : [location.city];
          const cleanCities = cities.filter(Boolean).map((c: any) => c.trim());
          if (cleanCities.length > 0) {
            query['location.city'] = { $in: cleanCities.map((c: any) => new RegExp('^' + escapeRegExp(c) + '$', 'i')) };
          }
        }
        if (location.state) {
          const states = Array.isArray(location.state) ? location.state : [location.state];
          const cleanStates = states.filter(Boolean).map((s: any) => s.trim());
          if (cleanStates.length > 0) {
            query['location.state'] = { $in: cleanStates.map((s: any) => new RegExp('^' + escapeRegExp(s) + '$', 'i')) };
          }
        }
      }

      // Basic filters: Salary / Income
      if (minIncome !== undefined || maxIncome !== undefined) {
        const queryIncome: any = {};
        if (minIncome !== undefined && minIncome !== '') {
          const val = Number(minIncome);
          if (!isNaN(val)) {
            queryIncome.$gte = val;
          }
        }
        if (maxIncome !== undefined && maxIncome !== '') {
          const val = Number(maxIncome);
          if (!isNaN(val)) {
            queryIncome.$lte = val;
          }
        }
        if (Object.keys(queryIncome).length > 0) {
          query.income = queryIncome;
        }
      }

      // Basic filters: Profession
      if (occupation) {
        const occupations = Array.isArray(occupation) ? occupation : [occupation];
        const cleanOccs = occupations.filter(Boolean).map(o => o.trim());
        if (cleanOccs.length > 0) {
          const occRegexes = cleanOccs.map(o => new RegExp(escapeRegExp(o), 'i'));
          query.$or = [
            ...(query.$or || []),
            { occupation: { $in: occRegexes } },
            { 'career.occupation': { $in: occRegexes } }
          ];
        }
      }

      // Premium filters: Horoscope elements
      let hasHoroscopeFilters = false;
      const horoscopeQuery: any = {};

      if (horoscope) {
        if (horoscope.sevvaiDosham !== undefined && horoscope.sevvaiDosham !== 'any') {
          horoscopeQuery['doshaDetails.sevvaiDosham'] = horoscope.sevvaiDosham === true || horoscope.sevvaiDosham === 'yes';
          hasHoroscopeFilters = true;
        }
        if (horoscope.raguKethuDosham !== undefined && horoscope.raguKethuDosham !== 'any') {
          horoscopeQuery['doshaDetails.raguKethuDosham'] = horoscope.raguKethuDosham === true || horoscope.raguKethuDosham === 'yes';
          hasHoroscopeFilters = true;
        }
        if (horoscope.rashi) {
          const rashis = Array.isArray(horoscope.rashi) ? horoscope.rashi : [horoscope.rashi];
          const cleanRashis = rashis.filter(Boolean).map((r: any) => r.trim());
          if (cleanRashis.length > 0) {
            horoscopeQuery.rashi = { $in: cleanRashis.map((r: any) => new RegExp('^' + escapeRegExp(r) + '$', 'i')) };
            hasHoroscopeFilters = true;
          }
        }
        if (horoscope.nakshatra) {
          const nakshatras = Array.isArray(horoscope.nakshatra) ? horoscope.nakshatra : [horoscope.nakshatra];
          const cleanNaks = nakshatras.filter(Boolean).map((n: any) => n.trim());
          if (cleanNaks.length > 0) {
            horoscopeQuery.nakshatra = { $in: cleanNaks.map((n: any) => new RegExp('^' + escapeRegExp(n) + '$', 'i')) };
            hasHoroscopeFilters = true;
          }
        }
      }

      if (hasHoroscopeFilters) {
        const matchedHoroscopes = await Horoscope.find(horoscopeQuery).select('profile');
        const matchedProfileIds = matchedHoroscopes.map((h) => h.profile);
        
        // If we already have ids from other matching filters, intersect them
        if (query._id) {
          query._id = { $in: matchedProfileIds.filter(id => query._id.$in.map((mid: any) => mid.toString()).includes(id.toString())) };
        } else {
          query._id = { $in: matchedProfileIds };
        }
      }

      // Premium search options
      if (premiumOptions) {
        if (premiumOptions.verifiedOnly) {
          query.isVerified = true;
        }
        if (premiumOptions.hasVoice) {
          query.voiceIntroUrl = { $ne: null, $exists: true };
        }
        if (premiumOptions.hasVideo) {
          query.videoIntroUrl = { $ne: null, $exists: true };
        }
      }

      // 4. Execute Query
      const matchedProfiles = await Profile.find(query)
        .limit(limit)
        .sort({ isVerified: -1, createdAt: -1 });

      const securedProfiles = await Promise.all(
        matchedProfiles.map((p) => secureProfileMedia(p, req.user))
      );

      return sendResponse(res, 200, true, 'Search profiles completed successfully.', {
        profiles: securedProfiles,
        premiumUpgradeRequired
      });
    } catch (error: any) {
      logger.error(`searchProfiles error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to perform profile search.');
    }
  };

  /**
   * Fetch home dashboard collections: recommended, premium, recently active, and trending matches
   */
  static getDashboardData = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const myId = req.user._id;
      const myProfile = await Profile.findOne({ user: myId });
      if (!myProfile) {
        return sendResponse(res, 400, false, 'Profile not found. Please create a profile first.');
      }

      const targetGender = myProfile.gender === 'male' ? 'female' : 'male';
      const myUserIdString = myId.toString();

      // Find existing swipes to exclude
      const swipedMatches = await Match.find({
        $or: [{ user1: myId }, { user2: myId }],
      });
      const swipedUserIds = swipedMatches.map((m) =>
        m.user1.toString() === myUserIdString ? m.user2 : m.user1
      );

      // Find existing interest requests to exclude
      const interestRequests = await mongoose.model('InterestRequest').find({
        $or: [{ sender: myId }, { receiver: myId }]
      });
      const interestUserIds = interestRequests.map((r: any) =>
        r.sender.toString() === myUserIdString ? r.receiver : r.sender
      );

      const excludedUserIds = [...swipedUserIds, ...interestUserIds, myId];

      // 1. Fetch Spotlight Profiles (explicitly boosted to spotlight category)
      const spotlightsRaw = await Profile.find({
        user: { $nin: excludedUserIds },
        gender: targetGender,
        'boost.isBoosted': true,
        'boost.boostType': 'spotlight',
        'boost.boostExpiresAt': { $gt: new Date() }
      }).limit(10);

      const spotlight = await Promise.all(
        spotlightsRaw.map((p) => secureProfileMedia(p, req.user))
      );

      // 2. Fetch Recently Active
      const recentlyActiveRaw = await Profile.find({
        user: { $nin: excludedUserIds },
        gender: targetGender
      })
        .sort({ updatedAt: -1 })
        .limit(10);

      const recentlyActive = await Promise.all(
        recentlyActiveRaw.map((p) => secureProfileMedia(p, req.user))
      );

      // 3. Fetch Premium Profiles
      const premiumUsers = await User.find({
        'subscription.status': 'active',
        'subscription.plan': { $ne: 'free' }
      }).select('_id');
      const premiumUserIds = premiumUsers.map((u) => u._id);

      const premiumProfilesRaw = await Profile.find({
        user: { $in: premiumUserIds, $nin: excludedUserIds },
        gender: targetGender
      }).limit(10);

      const premium = await Promise.all(
        premiumProfilesRaw.map((p) => secureProfileMedia(p, req.user))
      );

      // 4. Fetch Recommended Profiles (scored and ranked by matchmaker service + boost weight)
      const candidateProfiles = await Profile.find({
        user: { $nin: excludedUserIds },
        gender: targetGender
      }).limit(30);

      const scoredCandidates = candidateProfiles.map((c) => {
        const scoreResult = MatchmakingService.calculateMatchScore(myProfile, c);
        const profileObj = typeof c.toObject === 'function' ? c.toObject() : c;

        // Apply ranking score boosts to Recommended and Trending candidates
        const isBoosted = c.boost?.isBoosted && c.boost?.boostExpiresAt && new Date(c.boost.boostExpiresAt) > new Date();
        const boostType = isBoosted ? c.boost?.boostType : null;
        let rankScore = scoreResult.score;
        if (isBoosted) {
          if (boostType === 'spotlight') rankScore += 20;
          else if (boostType === 'trending') rankScore += 10;
        }

        return {
          ...profileObj,
          matchScore: scoreResult.score,
          rankScore,
          matchReasons: scoreResult.reasons,
          scoreBreakdown: scoreResult.breakdown
        };
      });

      const recommendedSorted = scoredCandidates
        .sort((a, b) => b.rankScore - a.rankScore)
        .slice(0, 10);

      const recommended = await Promise.all(
        recommendedSorted.map((p) => secureProfileMedia(p, req.user))
      );

      // 5. Fetch Trending Matches (verified profiles with high match score, prioritized by trending boosts)
      const trendingRaw = await Profile.find({
        user: { $nin: excludedUserIds },
        gender: targetGender,
        isVerified: true
      }).limit(20);

      const trendingProfiles = trendingRaw.map((c) => {
        const scoreResult = MatchmakingService.calculateMatchScore(myProfile, c);
        const profileObj = typeof c.toObject === 'function' ? c.toObject() : c;

        const isBoosted = c.boost?.isBoosted && c.boost?.boostExpiresAt && new Date(c.boost.boostExpiresAt) > new Date();
        const boostType = isBoosted ? c.boost?.boostType : null;
        let rankScore = scoreResult.score;
        if (isBoosted) {
          if (boostType === 'spotlight') rankScore += 20;
          else if (boostType === 'trending') rankScore += 10;
        }

        return {
          ...profileObj,
          matchScore: scoreResult.score,
          rankScore,
          matchReasons: scoreResult.reasons
        };
      });

      const trendingSorted = trendingProfiles
        .sort((a, b) => b.rankScore - a.rankScore)
        .slice(0, 10);

      const trending = await Promise.all(
        trendingSorted.map((p) => secureProfileMedia(p, req.user))
      );

      return sendResponse(res, 200, true, 'Dashboard data loaded successfully.', {
        spotlight,
        recentlyActive,
        premium,
        recommended,
        trending
      });
    } catch (error: any) {
      logger.error(`getDashboardData error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to fetch dashboard collections.');
    }
  };

  /**
   * Activate a profile boost (spotlight or trending) for the authenticated user
   */
  static activateBoost = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const { boostType } = req.body; // 'spotlight' | 'trending'
      if (!['spotlight', 'trending'].includes(boostType)) {
        return sendResponse(res, 400, false, 'Invalid boost type. Must be spotlight or trending.');
      }

      const myId = req.user._id;
      const profile = await Profile.findOne({ user: myId });
      if (!profile) {
        return sendResponse(res, 400, false, 'Profile not found. Please create a profile first.');
      }

      // Check user subscription plan
      const plan = req.user.subscription?.plan || 'free';
      const status = req.user.subscription?.status || 'inactive';
      
      // Compute duration: 24 hours for active premium, 1 hour for free trial
      const isPremium = status === 'active' && ['silver', 'gold', 'platinum'].includes(plan);
      const durationHours = isPremium ? 24 : 1;
      const boostExpiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);

      profile.boost = {
        isBoosted: true,
        boostExpiresAt,
        boostType
      };

      await profile.save();

      logger.info(`Profile boost (${boostType}) activated for user ${myId}. Expires at ${boostExpiresAt.toISOString()}`);
      
      return sendResponse(res, 200, true, 'Profile boost activated successfully.', {
        profile,
        boostDurationHours: durationHours,
        boostExpiresAt,
        premiumUpgradeRequired: !isPremium
      });
    } catch (error: any) {
      logger.error(`activateBoost error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to activate profile boost.');
    }
  };

  /**
   * Unlock direct contact details of another profile
   */
  static unlockContact = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const targetProfileId = req.params.id;
      if (!mongoose.Types.ObjectId.isValid(targetProfileId)) {
        return sendResponse(res, 400, false, 'Invalid profile ID format.');
      }

      const targetProfile = await Profile.findById(targetProfileId);
      if (!targetProfile) {
        return sendResponse(res, 404, false, 'Target profile not found.');
      }

      const targetUserId = targetProfile.user;
      if (targetUserId.toString() === req.user._id.toString()) {
        return sendResponse(res, 400, false, 'You cannot unlock your own contact details.');
      }

      const currentUser = await User.findById(req.user._id);
      if (!currentUser) {
        return sendResponse(res, 404, false, 'Authenticated user not found.');
      }

      // Check if already unlocked
      const alreadyUnlocked = currentUser.unlockedContacts?.some(
        (id: any) => id.toString() === targetUserId.toString()
      );

      const targetUser = await User.findById(targetUserId);

      if (alreadyUnlocked) {
        return sendResponse(res, 200, true, 'Contact already unlocked.', {
          email: targetUser?.email || 'N/A',
          phone: targetUser?.phone || 'N/A'
        });
      }

      // Verify premium status
      const plan = currentUser.subscription?.plan || 'free';
      const status = currentUser.subscription?.status || 'inactive';
      const isPremium = status === 'active' && ['silver', 'gold', 'platinum'].includes(plan);

      if (!isPremium) {
        return res.status(403).json({
          success: false,
          message: 'Premium subscription required to unlock contacts.',
          code: 'upgrade_required'
        });
      }

      // Check tier limits: silver -> 20, gold -> 40, platinum -> 60
      const limit = plan === 'platinum' ? 60 : plan === 'gold' ? 40 : 20;
      const unlockedCount = currentUser.unlockedContacts?.length || 0;

      if (unlockedCount >= limit) {
        return res.status(403).json({
          success: false,
          message: `You have reached your contact unlock limit of ${limit} contacts for the ${plan.toUpperCase()} tier.`,
          code: 'limit_reached'
        });
      }

      // Add to unlockedContacts list and save
      currentUser.unlockedContacts = currentUser.unlockedContacts || [];
      currentUser.unlockedContacts.push(targetUserId);
      await currentUser.save();

      logger.info(`User ${currentUser._id} unlocked contact of ${targetUserId}. (${unlockedCount + 1}/${limit} used)`);

      return sendResponse(res, 200, true, 'Contact details unlocked successfully.', {
        email: targetUser?.email || 'N/A',
        phone: targetUser?.phone || 'N/A'
      });
    } catch (error: any) {
      logger.error(`unlockContact error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to unlock contact details.');
    }
  };

  /**
   * Submit Government ID for verification
   * POST /api/v1/profile/verify-id
   */
  static submitIdVerification = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { idProofType, idProofBase64 } = req.body;
      if (!idProofType || !['aadhaar', 'pan', 'voter_id', 'driving_license'].includes(idProofType)) {
        return sendResponse(res, 400, false, 'Invalid or missing document type.');
      }
      if (!idProofBase64) {
        return sendResponse(res, 400, false, 'Document image content (base64) is required.');
      }
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const profile = await Profile.findOne({ user: req.user._id });
      if (!profile) {
        return sendResponse(res, 404, false, 'Profile not found.');
      }

      const host = req.get('host') || 'localhost:5000';
      const proofUrl = await processAndUploadPhoto(
        req.user._id.toString(),
        idProofBase64,
        host
      );

      profile.idProofUrl = proofUrl;
      profile.idProofType = idProofType as any;
      profile.verificationStatus = 'pending';
      await profile.save();

      logger.info(`Verification request submitted for user ${req.user._id}. Doc: ${idProofType}`);
      return sendResponse(res, 200, true, 'Verification documents submitted successfully.', {
        verificationStatus: 'pending',
        idProofUrl: proofUrl,
        idProofType
      });
    } catch (error: any) {
      logger.error(`submitIdVerification error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to submit ID verification.', error.message);
    }
  };

  /**
   * POST /api/v1/profile/nl-search
   * Natural Language Partner Search using Gemini AI parser
   */
  static nlSearch = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { query } = req.body;
      if (!query || typeof query !== 'string' || !query.trim()) {
        return sendResponse(res, 400, false, 'Search query is required.');
      }

      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      // 1. Fetch user's own profile to determine target gender
      const myProfile = await Profile.findOne({ user: req.user._id });
      const myGender = myProfile?.gender || 'male';
      const targetGender = myGender === 'male' ? 'female' : 'male';

      let parsed: any = {};

      if (genAI) {
        try {
          const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
          const prompt = `
            You are a translation assistant for a matrimony search engine named IraiInai.
            Convert the user's natural language search query into structured search filters.
            
            Search query: "${query}"
            Target Gender context: "${targetGender}" (default target gender is opposite of searcher's gender)
            
            Return a JSON response matching this schema:
            {
              "city": "string (city name, or empty if not mentioned)",
              "state": "string (state name, or empty if not mentioned)",
              "occupationKeywords": ["array of job title keywords or occupation categories e.g. software, IT, doctor, engineer"],
              "religion": "string (e.g. Hindu, Christian, Muslim, or empty if not mentioned)",
              "community": "string (caste or community name, or empty if not mentioned)",
              "minAge": "number (inferred minimum age range, e.g. 25, or null)",
              "maxAge": "number (inferred maximum age range, e.g. 35, or null)",
              "interestsKeywords": ["array of hobbies or interests mentioned, e.g. travel, music, trekking, sports"],
              "familyValues": ["orthodox" | "traditional" | "moderate" | "liberal" (array of matching value types)],
              "gender": "male" | "female"
            }
            
            Ensure your output is a valid JSON block and nothing else.
          `;

          const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' },
          });

          const cleanJson = result.response.text().trim().replace(/```json|```/g, '').trim();
          parsed = JSON.parse(cleanJson);
        } catch (aiErr: any) {
          logger.error(`NL Search AI parsing failed: ${aiErr.message}`);
        }
      }

      // If AI failed or not set up, build basic search tags via rule-based regex
      if (!parsed || Object.keys(parsed).length === 0) {
        parsed = {
          city: query.match(/from\s+([A-Za-z]+)/i)?.[1] || '',
          occupationKeywords: query.match(/an?\s+([A-Za-z]+)\s+professional/i)?.[1] ? [query.match(/an?\s+([A-Za-z]+)\s+professional/i)?.[1]!] : [],
          interestsKeywords: query.match(/likes?\s+([A-Za-z]+)/i)?.[1] ? [query.match(/likes?\s+([A-Za-z]+)/i)?.[1]!] : [],
          gender: targetGender,
        };
      }

      // 2. Build MongoDB query
      const dbQuery: any = {};

      // Match target gender
      dbQuery.gender = parsed.gender || targetGender;

      // Filter out shadowbanned users
      const shadowbanned = await User.find({ isShadowBanned: true }).select('_id');
      const shadowbannedIds = shadowbanned.map((u) => u._id);
      dbQuery.user = { $nin: [...shadowbannedIds, req.user._id] };

      // City filter
      if (parsed.city) {
        dbQuery['location.city'] = new RegExp(parsed.city, 'i');
      }
      
      // State filter
      if (parsed.state) {
        dbQuery['location.state'] = new RegExp(parsed.state, 'i');
      }

      // Occupation filter
      if (parsed.occupationKeywords && parsed.occupationKeywords.length > 0) {
        const occRegex = parsed.occupationKeywords.map((k: string) => new RegExp(k, 'i'));
        dbQuery['$or'] = [
          { 'career.occupation': { $in: occRegex } },
          { 'occupation': { $in: occRegex } }
        ];
      }

      // Hobbies/Interests filter
      if (parsed.interestsKeywords && parsed.interestsKeywords.length > 0) {
        const intRegex = parsed.interestsKeywords.map((k: string) => new RegExp(k, 'i'));
        dbQuery.interests = { $in: intRegex };
      }

      // Religion filter
      if (parsed.religion) {
        dbQuery.religion = new RegExp(parsed.religion, 'i');
      }

      // Community/Caste filter
      if (parsed.community) {
        dbQuery.community = new RegExp(parsed.community, 'i');
      }

      // Family Values filter
      if (parsed.familyValues && parsed.familyValues.length > 0) {
        dbQuery.familyValues = { $in: parsed.familyValues };
      }

      // Age range filter
      const now = new Date();
      const dobQuery: any = {};
      if (parsed.minAge) {
        const maxDob = new Date(now.getFullYear() - parsed.minAge, now.getMonth(), now.getDate());
        dobQuery['$lte'] = maxDob;
      }
      if (parsed.maxAge) {
        const minDob = new Date(now.getFullYear() - parsed.maxAge - 1, now.getMonth(), now.getDate());
        dobQuery['$gte'] = minDob;
      }
      if (Object.keys(dobQuery).length > 0) {
        dbQuery.dob = dobQuery;
      }

      // Execute search query
      const profiles = await Profile.find(dbQuery).limit(20).lean();

      // Secure photo urls before sending
      const securedProfiles = await Promise.all(
        profiles.map((p) => secureProfilePhotos(p as any, req.user))
      );

      logger.info(`NL Search complete for query: "${query}". Found ${securedProfiles.length} matches.`);

      return sendResponse(res, 200, true, 'Search complete.', {
        filters: parsed,
        results: securedProfiles,
      });

    } catch (error: any) {
      logger.error(`nlSearch error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to process natural language search.', error.message);
    }
  };
}
