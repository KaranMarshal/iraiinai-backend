export interface IMissingField {
  field: string;
  label: string;
  weight: number;
  description: string;
}

export interface IBadge {
  type: string;
  label: string;
  icon: string;
  color: string;
}

/**
 * Calculates profile completion percentage, identifies missing fields, and generates verification badges.
 */
export const calculateProfileCompletion = (profile: any, user?: any) => {
  const missingFields: IMissingField[] = [];
  let percentage = 0;

  // Basic Info (20%)
  if (profile.name && profile.name.trim()) {
    percentage += 5;
  } else {
    missingFields.push({
      field: 'name',
      label: 'Full Name',
      weight: 5,
      description: 'Enter your full name so matches know who you are.',
    });
  }

  if (profile.gender) {
    percentage += 5;
  } else {
    missingFields.push({
      field: 'gender',
      label: 'Gender',
      weight: 5,
      description: 'Select your gender.',
    });
  }

  if (profile.dob) {
    percentage += 5;
  } else {
    missingFields.push({
      field: 'dob',
      label: 'Date of Birth',
      weight: 5,
      description: 'Add your date of birth to calculate age.',
    });
  }

  if (profile.location?.city && profile.location?.state) {
    percentage += 5;
  } else {
    missingFields.push({
      field: 'location',
      label: 'City & State',
      weight: 5,
      description: 'Set your current location (City & State) for matching purposes.',
    });
  }

  // Photos (20%)
  if (profile.photos && profile.photos.length > 0) {
    percentage += 10;
    if (profile.photos.length >= 2) {
      percentage += 5;
    }
    if (profile.photos.length >= 3) {
      percentage += 5;
    } else {
      missingFields.push({
        field: 'photos_additional',
        label: 'Upload more photos',
        weight: 5,
        description: 'Upload at least 3 photos to get higher matches interest.',
      });
    }
  } else {
    missingFields.push({
      field: 'photos',
      label: 'Primary Profile Photo',
      weight: 20,
      description: 'Upload a primary photo. Profiles with photos get 10x more responses.',
    });
  }

  // Bio (15%)
  if (profile.bio && profile.bio.trim().length > 10) {
    percentage += 15;
  } else {
    missingFields.push({
      field: 'bio',
      label: 'Matrimonial Bio',
      weight: 15,
      description: 'Write an expressive bio detailing your personality and family background.',
    });
  }

  // Career & Education (20%)
  if (profile.education?.qualification) {
    percentage += 5;
  } else {
    missingFields.push({
      field: 'qualification',
      label: 'Education Qualification',
      weight: 5,
      description: 'Add your highest education degree.',
    });
  }

  if (profile.occupation || profile.career?.occupation) {
    percentage += 5;
  } else {
    missingFields.push({
      field: 'occupation',
      label: 'Occupation',
      weight: 5,
      description: 'Provide details about your occupation or career role.',
    });
  }

  const incomeVal = profile.income || profile.career?.annualIncome;
  if (incomeVal && incomeVal !== 'Not Specified' && incomeVal !== '—') {
    percentage += 5;
  } else {
    missingFields.push({
      field: 'annualIncome',
      label: 'Annual Income',
      weight: 5,
      description: 'Select your annual income to help match with preferred ranges.',
    });
  }

  if (profile.career?.companyName) {
    percentage += 5;
  } else {
    missingFields.push({
      field: 'companyName',
      label: 'Company Name',
      weight: 5,
      description: 'Enter your employer or company name.',
    });
  }

  // Family Details (15%)
  const hasParentsOccupation = profile.familyDetails?.fatherOccupation || profile.familyDetails?.motherOccupation;
  if (hasParentsOccupation) {
    percentage += 5;
  } else {
    missingFields.push({
      field: 'parentsOccupation',
      label: 'Parent\'s Occupation',
      weight: 5,
      description: 'Add details about your father or mother\'s occupation.',
    });
  }

  if (profile.familyDetails?.familyType) {
    percentage += 5;
  } else {
    missingFields.push({
      field: 'familyType',
      label: 'Family Type',
      weight: 5,
      description: 'Specify whether your family is Nuclear, Joint, or Extended.',
    });
  }

  if (profile.familyDetails?.familyStatus) {
    percentage += 5;
  } else {
    missingFields.push({
      field: 'familyStatus',
      label: 'Family Status',
      weight: 5,
      description: 'Select your family background status (e.g. Middle Class, Upper Middle).',
    });
  }

  // Video/Voice (10%)
  if (profile.videoIntroUrl) {
    percentage += 5;
  } else {
    missingFields.push({
      field: 'videoIntroUrl',
      label: 'Video Introduction',
      weight: 5,
      description: 'Upload a 30s video introduction to showcase your personality.',
    });
  }

  if (profile.voiceIntroUrl) {
    percentage += 5;
  } else {
    missingFields.push({
      field: 'voiceIntroUrl',
      label: 'Voice Introduction',
      weight: 5,
      description: 'Record an audio snippet introducing yourself in your own voice.',
    });
  }

  // Cap percentage
  percentage = Math.min(percentage, 100);

  // Verification Badges
  const badges: IBadge[] = [];

  if (user?.email && !user.email.includes('.temporary')) {
    badges.push({
      type: 'email',
      label: 'Email Verified',
      icon: 'envelope-circle-check',
      color: '#10B981', // emerald-500
    });
  }

  // Default true for the primary mock user to make testing easy
  if (user?.phone || (user?.email && user.email.startsWith('mock_user'))) {
    badges.push({
      type: 'phone',
      label: 'Phone Verified',
      icon: 'phone-volume',
      color: '#3B82F6', // blue-500
    });
  }

  if (profile.isVerified) {
    badges.push({
      type: 'identity',
      label: 'Identity Verified',
      icon: 'shield-halved',
      color: '#C5A059', // brand gold
    });
  }

  if (profile.videoIntroUrl || profile.voiceIntroUrl) {
    badges.push({
      type: 'media',
      label: 'Media Verified',
      icon: 'circle-play',
      color: '#A855F7', // purple-500
    });
  }

  return {
    percentage,
    missingFields,
    badges,
  };
};
