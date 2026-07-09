import { logger } from '../utils/logger';

export interface IMatchResult {
  score: number;
  reasons: string[];
  breakdown: {
    preferences: number;
    community: number;
    location: number;
    education: number;
    career: number;
  };
}

export class MatchmakingService {
  /**
   * Computes a compatibility match score (0-100) between two profiles
   */
  static calculateMatchScore(myProfile: any, partnerProfile: any): IMatchResult {
    let prefScore = 0; // max 30
    let commScore = 0; // max 20
    let locScore = 0;  // max 15
    let eduScore = 0;  // max 15
    let carScore = 0;  // max 20
    const reasons: string[] = [];

    // --- 1. Partner Preference Logic (30 points) ---
    // A. Age range preference (10 points)
    const partnerAge = partnerProfile.age || 
      (partnerProfile.dob ? new Date().getFullYear() - new Date(partnerProfile.dob).getFullYear() : 28);
    const prefAge = myProfile.preferences?.ageRange || { min: 21, max: 35 };
    if (partnerAge >= prefAge.min && partnerAge <= prefAge.max) {
      prefScore += 10;
      reasons.push('Age matches preferred range');
    } else {
      const diff = Math.min(Math.abs(partnerAge - prefAge.min), Math.abs(partnerAge - prefAge.max));
      if (diff <= 2) {
        prefScore += 6;
        reasons.push('Age is very close to preference');
      } else if (diff <= 4) {
        prefScore += 3;
      }
    }

    // B. Location preference (10 points)
    const prefLocations = myProfile.preferences?.locations || [];
    if (prefLocations.length === 0) {
      prefScore += 10;
    } else {
      const isCityMatched = prefLocations.some(
        (loc: string) => loc.toLowerCase() === partnerProfile.location?.city?.toLowerCase()
      );
      if (isCityMatched) {
        prefScore += 10;
        reasons.push(`Located in preferred city: ${partnerProfile.location?.city}`);
      } else {
        const isStateMatched = prefLocations.some(
          (loc: string) => loc.toLowerCase() === partnerProfile.location?.state?.toLowerCase()
        );
        if (isStateMatched || (myProfile.location?.state && partnerProfile.location?.state && myProfile.location.state.toLowerCase() === partnerProfile.location.state.toLowerCase())) {
          prefScore += 5;
          reasons.push(`Located in preferred state: ${partnerProfile.location?.state}`);
        }
      }
    }

    // C. Religion preference (10 points)
    const prefReligions = myProfile.preferences?.religions || [];
    if (prefReligions.length === 0) {
      prefScore += 10;
    } else {
      const isReligionMatched = prefReligions.some(
        (rel: string) => rel.toLowerCase() === partnerProfile.religion?.toLowerCase()
      );
      if (isReligionMatched) {
        prefScore += 10;
        reasons.push(`Shares preferred religion: ${partnerProfile.religion}`);
      }
    }

    // --- 2. Community & Background Match (20 points) ---
    // A. Shared Religion (5 points)
    if (myProfile.religion && partnerProfile.religion && 
        myProfile.religion.toLowerCase() === partnerProfile.religion.toLowerCase()) {
      commScore += 5;
      reasons.push('Same religious background');
    }

    // B. Shared Caste/Community (5 points)
    const myCaste = myProfile.caste || myProfile.community || '';
    const partnerCaste = partnerProfile.caste || partnerProfile.community || '';
    if (myCaste && partnerCaste && myCaste.toLowerCase() === partnerCaste.toLowerCase()) {
      commScore += 5;
      reasons.push(`Same community: ${partnerCaste}`);
    }

    // C. Shared Mother Tongue (10 points)
    if (myProfile.motherTongue && partnerProfile.motherTongue && 
        myProfile.motherTongue.toLowerCase() === partnerProfile.motherTongue.toLowerCase()) {
      commScore += 10;
      reasons.push(`Same mother tongue: ${partnerProfile.motherTongue}`);
    }

    // --- 3. Location Proximity (15 points) ---
    if (myProfile.location && partnerProfile.location) {
      const myCity = myProfile.location.city?.toLowerCase();
      const partnerCity = partnerProfile.location.city?.toLowerCase();
      const myState = myProfile.location.state?.toLowerCase();
      const partnerState = partnerProfile.location.state?.toLowerCase();

      if (myCity && partnerCity && myCity === partnerCity) {
        locScore += 15;
        reasons.push(`Both reside in ${partnerProfile.location.city}`);
      } else if (myState && partnerState && myState === partnerState) {
        locScore += 10;
        reasons.push(`Both based in ${partnerProfile.location.state}`);
      } else if (myProfile.location.country && partnerProfile.location.country && 
                 myProfile.location.country.toLowerCase() === partnerProfile.location.country.toLowerCase()) {
        locScore += 5;
      }
    }

    // --- 4. Education Compatibility (15 points) ---
    const getEduTier = (qualification: string): number => {
      if (!qualification) return 1;
      const q = qualification.toLowerCase();
      if (q.includes('phd') || q.includes('doctorate') || q.includes('m.tech') || q.includes('m.e') || q.includes('mba') || q.includes('m.s') || q.includes('md') || q.includes('ms') || q.includes('postgraduate') || q.includes('m.sc') || q.includes('mca') || q.includes('m.com')) {
        return 3;
      }
      if (q.includes('b.tech') || q.includes('b.e') || q.includes('mbbs') || q.includes('b.sc') || q.includes('graduate') || q.includes('degree') || q.includes('bca') || q.includes('bba') || q.includes('b.com') || q.includes('b.a')) {
        return 2;
      }
      return 1;
    };

    const myEdu = myProfile.education?.qualification || '';
    const partnerEdu = partnerProfile.education?.qualification || '';
    const myTier = getEduTier(myEdu);
    const partnerTier = getEduTier(partnerEdu);

    if (myTier === partnerTier) {
      eduScore += 15;
      reasons.push('Compatible educational tier');
    } else if (Math.abs(myTier - partnerTier) === 1) {
      eduScore += 10;
    } else {
      eduScore += 5;
    }

    // --- 5. Profession & Career Compatibility (20 points) ---
    // A. Income Preference Check (10 points)
    const myMinIncome = myProfile.preferences?.minIncome || 0;
    const partnerIncome = partnerProfile.income || 0;
    
    const partnerMinIncome = partnerProfile.preferences?.minIncome || 0;
    const myIncome = myProfile.income || 0;

    let incomeMatch = true;
    if (myMinIncome > 0 && partnerIncome > 0 && partnerIncome < myMinIncome) {
      incomeMatch = false;
    }
    if (partnerMinIncome > 0 && myIncome > 0 && myIncome < partnerMinIncome) {
      incomeMatch = false;
    }

    if (incomeMatch) {
      carScore += 10;
      if (myMinIncome > 0 || partnerMinIncome > 0) {
        reasons.push('Income meets expectations');
      }
    } else {
      carScore += 4;
    }

    // B. Career Alignment (10 points)
    const myOccupation = myProfile.occupation || myProfile.career?.occupation || '';
    const partnerOccupation = partnerProfile.occupation || partnerProfile.career?.occupation || '';

    const isMyWorking = myOccupation && myOccupation.toLowerCase() !== 'not working' && myOccupation.toLowerCase() !== 'not_working';
    const isPartnerWorking = partnerOccupation && partnerOccupation.toLowerCase() !== 'not working' && partnerOccupation.toLowerCase() !== 'not_working';

    if (isMyWorking && isPartnerWorking) {
      carScore += 10;
      reasons.push('Both working professionals');
    } else if (isMyWorking || isPartnerWorking) {
      carScore += 6;
    } else {
      carScore += 3;
    }

    const totalScore = Math.min(100, Math.round(prefScore + commScore + locScore + eduScore + carScore));

    return {
      score: totalScore,
      reasons: reasons.slice(0, 3),
      breakdown: {
        preferences: prefScore,
        community: commScore,
        location: locScore,
        education: eduScore,
        career: carScore
      }
    };
  }
}
