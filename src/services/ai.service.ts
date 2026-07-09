import { GoogleGenerativeAI } from '@google/generative-ai';
import { ENV } from '../config/env';
import { logger } from '../utils/logger';

// Initialize Gemini SDK if API key is provided
let genAI: GoogleGenerativeAI | null = null;
if (ENV.GEMINI_API_KEY && ENV.GEMINI_API_KEY !== 'YourGeminiApiKeyHere') {
  genAI = new GoogleGenerativeAI(ENV.GEMINI_API_KEY);
  logger.info('Gemini AI Service successfully initialized.');
} else {
  logger.warn('Gemini API key not configured. Matching calculations will fallback to mock algorithms.');
}

export class AIService {
  /**
   * Generates a descriptive AI-summary for a profile based on demographics, occupation, and hobbies.
   */
  static async generateProfileSummary(profileData: any): Promise<string> {
    try {
      if (!genAI) {
        return `${profileData.name} is a ${profileData.gender} working as a ${profileData.occupation || 'professional'} from ${profileData.location.city}. Interests include ${profileData.interests.join(', ')}.`;
      }

      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const prompt = `
        Summarize the following matrimony profile in a warm, premium, and professional tone. Highlight their background, location, and key interests. Keep it concise (2-3 sentences max).
        Profile Details:
        - Name: ${profileData.name}
        - Gender: ${profileData.gender}
        - Age: ${new Date().getFullYear() - new Date(profileData.dob).getFullYear()}
        - Occupation: ${profileData.occupation || 'Not Specified'}
        - Income: ${profileData.income ? `${profileData.income} INR/year` : 'Not Specified'}
        - Location: ${profileData.location.city}, ${profileData.location.state}
        - Interests: ${profileData.interests.join(', ')}
        - Raw Bio: ${profileData.bio || 'None'}
      `;

      const result = await model.generateContent(prompt);
      const text = result.response.text();
      return text.trim();
    } catch (error: any) {
      logger.error(`Error in generateProfileSummary: ${error.message}`);
      return `A profile representing ${profileData.name} located in ${profileData.location.city}.`;
    }
  }

  /**
   * Evaluates the compatibility between two profiles using demographics, preferences, interests, and bio.
   */
  static async computeCompatibility(
    profile1: any,
    profile2: any,
    horoscope1?: any,
    horoscope2?: any
  ): Promise<{
    score: number;
    reasoning: string;
    breakdown?: {
      demographics: number;
      lifestyle: number;
      astrology: number;
      values: number;
    };
    details?: {
      demographics: string;
      lifestyle: string;
      astrology: string;
      values: string;
    };
  }> {
    try {
      const facts = `
        Profile 1:
        - Name: ${profile1.name}
        - Gender: ${profile1.gender}
        - Age: ${new Date().getFullYear() - new Date(profile1.dob).getFullYear()}
        - Occupation: ${profile1.occupation || 'Not Specified'}
        - Education: ${profile1.education?.qualification || 'Not Specified'}
        - Location: ${profile1.location.city}, ${profile1.location.state}
        - Religion: ${profile1.religion || 'Not Specified'}
        - Community/Caste: ${profile1.caste || 'Not Specified'}
        - Salary/Income: ${profile1.income ? `${profile1.income} INR/year` : 'Not Specified'}
        - Food Habits: ${profile1.foodHabits || 'Not Specified'}
        - Lifestyle Type: ${profile1.lifestyleType || 'Not Specified'}
        - Family Values: ${profile1.familyValues || 'Not Specified'}
        - Partner Expectations: ${profile1.partnerExpectations || 'Not Specified'}
        - Interests/Hobbies: ${profile1.interests?.join(', ') || ''}
        - Bio: ${profile1.bio || ''}
        ${horoscope1 ? `
        - Rashi: ${horoscope1.rashi || 'Not Specified'}
        - Nakshatra: ${horoscope1.nakshatra || 'Not Specified'}
        - Manglik Status: ${horoscope1.manglikStatus || 'unknown'}
        - Sevvai Dosham: ${horoscope1.doshaDetails?.sevvaiDosham ? 'Yes' : 'No'}
        - Ragu Kethu Dosham: ${horoscope1.doshaDetails?.raguKethuDosham ? 'Yes' : 'No'}
        ` : ''}

        Profile 2:
        - Name: ${profile2.name}
        - Gender: ${profile2.gender}
        - Age: ${new Date().getFullYear() - new Date(profile2.dob).getFullYear()}
        - Occupation: ${profile2.occupation || 'Not Specified'}
        - Education: ${profile2.education?.qualification || 'Not Specified'}
        - Location: ${profile2.location.city}, ${profile2.location.state}
        - Religion: ${profile2.religion || 'Not Specified'}
        - Community/Caste: ${profile2.caste || 'Not Specified'}
        - Salary/Income: ${profile2.income ? `${profile2.income} INR/year` : 'Not Specified'}
        - Food Habits: ${profile2.foodHabits || 'Not Specified'}
        - Lifestyle Type: ${profile2.lifestyleType || 'Not Specified'}
        - Family Values: ${profile2.familyValues || 'Not Specified'}
        - Partner Expectations: ${profile2.partnerExpectations || 'Not Specified'}
        - Interests/Hobbies: ${profile2.interests?.join(', ') || ''}
        - Bio: ${profile2.bio || ''}
        ${horoscope2 ? `
        - Rashi: ${horoscope2.rashi || 'Not Specified'}
        - Nakshatra: ${horoscope2.nakshatra || 'Not Specified'}
        - Manglik Status: ${horoscope2.manglikStatus || 'unknown'}
        - Sevvai Dosham: ${horoscope2.doshaDetails?.sevvaiDosham ? 'Yes' : 'No'}
        - Ragu Kethu Dosham: ${horoscope2.doshaDetails?.raguKethuDosham ? 'Yes' : 'No'}
        ` : ''}
      `;

      if (!genAI) {
        // Fallback mock compatibility check based on shared interest overlap
        const sharedInterests = (profile1.interests || []).filter((i: string) =>
          (profile2.interests || []).includes(i)
        );
        
        let horoscopeRating = 80;
        let horoscopeReason = "No horoscope charts were provided, but basic natal alignments indicate standard compatibility.";

        if (horoscope1 && horoscope2) {
          const hasDosha1 = !!horoscope1.doshaDetails?.sevvaiDosham;
          const hasDosha2 = !!horoscope2.doshaDetails?.sevvaiDosham;
          if (hasDosha1 === hasDosha2) {
            horoscopeRating = 95;
            horoscopeReason = `Perfect Sevvai Dosham matching. Both profiles ${hasDosha1 ? 'have Sevvai Dosham' : 'are free from Sevvai Dosham'}, which is considered highly auspicious in Tamil tradition.`;
          } else {
            horoscopeRating = 45;
            horoscopeReason = `Sevvai Dosham mismatch detected. ${profile1.name} has ${hasDosha1 ? 'Sevvai Dosham' : 'no Sevvai Dosham'} while ${profile2.name} has ${hasDosha2 ? 'Sevvai Dosham' : 'no Sevvai Dosham'}. In traditional Tamil matrimony, this is considered a significant planetary mismatch.`;
          }
        }

        const score = Math.min(65 + sharedInterests.length * 6 + (horoscopeRating === 95 ? 10 : -10), 98);

        const mockDetails = {
          demographics: `${profile1.name} and ${profile2.name} show clean professional and demographic alignment. Their education levels and careers are complementary.`,
          lifestyle: `Shared interests in [${sharedInterests.join(', ') || 'general hobbies'}]. Their lifestyle types match well.`,
          astrology: horoscopeReason,
          values: `Strong cultural alignment with compatible family values and mutually supportive expectations.`
        };

        const mockBreakdown = {
          demographics: 85,
          lifestyle: 70 + sharedInterests.length * 5,
          astrology: horoscopeRating,
          values: 80
        };

        const mockSummary = `Highly compatible matchmaking profile with a score of ${score}%. Strong cultural, geographical, and demographic alignment.`;

        return {
          score,
          reasoning: JSON.stringify({
            score,
            breakdown: mockBreakdown,
            details: mockDetails,
            summary: mockSummary
          }),
          breakdown: mockBreakdown,
          details: mockDetails
        };
      }

      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const prompt = `
        You are an expert matchmaking AI counselor for the premium matrimony app "IraiInai".
        Compare the following two profiles (and their horoscopes if provided) and calculate an overall compatibility score (integer 0-100).
        Also, calculate compatibility ratings (0-100) for:
        - "demographics": compatibility based on age difference, education levels, profession, salary/income alignment, and location proximity.
        - "lifestyle": suitability of hobbies/interests, food habits, and general lifestyle choices.
        - "astrology": moon sign/star agreements, and Mars/Sevvai Dosham matching (both must have it or both must not have it. Mismatch is a negative factor).
        - "values": suitability based on religion, caste/community, family values, and partner expectations.

        Provide detailed descriptive justifications for each category.

        ${facts}

        Response format (strict JSON):
        {
          "score": 88,
          "breakdown": {
            "demographics": 85,
            "lifestyle": 90,
            "astrology": 95,
            "values": 80
          },
          "details": {
            "demographics": "Detailed explanation...",
            "lifestyle": "Detailed explanation...",
            "astrology": "Detailed explanation of Sevvai Dosham matching, Rashi, and Nakshatra...",
            "values": "Detailed description of cultural, religious, and expectations matching..."
          },
          "summary": "High-level summary of the compatibility analysis..."
        }
      `;

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      });

      const responseText = result.response.text();
      const parsed = JSON.parse(responseText);

      return {
        score: typeof parsed.score === 'number' ? parsed.score : 75,
        reasoning: responseText,
        breakdown: parsed.breakdown || { demographics: 75, lifestyle: 75, astrology: 75, values: 75 },
        details: parsed.details || { demographics: '', lifestyle: '', astrology: '', values: '' }
      };
    } catch (error: any) {
      logger.error(`Error in computeCompatibility: ${error.message}`);
      const fallbackScore = 70;
      const fallbackSummary = 'Calculated basic compatibility based on baseline demographics alignment.';
      const fallbackData = {
        score: fallbackScore,
        breakdown: { demographics: 70, lifestyle: 70, astrology: 70, values: 70 },
        details: {
          demographics: 'General compatibility aligned with basic values.',
          lifestyle: 'Basic lifestyle similarity.',
          astrology: 'No specific horoscope alignments found.',
          values: 'Shared baseline demographic values.'
        },
        summary: fallbackSummary
      };
      return {
        score: fallbackScore,
        reasoning: JSON.stringify(fallbackData),
        breakdown: fallbackData.breakdown,
        details: fallbackData.details
      };
    }
  }

  /**
   * Refines a raw bio written by a user into an elegant, expressive presentation.
   */
  static async polishBio(rawBio: string): Promise<string> {
    try {
      if (!genAI || !rawBio) return rawBio;

      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const prompt = `
        Review and polish this raw matrimonial bio draft. Make it sound appealing, warm, family-friendly, and elegant, while maintaining the user's authentic facts. Keep it under 150 words.
        Raw Bio: "${rawBio}"
      `;

      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch (error: any) {
      logger.error(`Error in polishBio: ${error.message}`);
      return rawBio;
    }
  }

  /**
   * Transcribes base64-encoded audio using Gemini 1.5 Flash.
   */
  static async transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
    try {
      if (!genAI) {
        logger.warn('Gemini API key not configured. Speech transcription falls back to mock text.');
        return 'This is a mock transcription of your speech because the Gemini API is not configured on the backend. Please check the backend .env file to configure GEMINI_API_KEY.';
      }

      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const audioPart = {
        inlineData: {
          data: audioBase64,
          mimeType: mimeType
        }
      };

      const prompt = 'You are a precise speech-to-text transcriber. Transcribe the spoken audio in the attached file accurately. Output ONLY the transcribed text. Do not add any introduction, explanations, or commentary. Do not summarize; write exactly what is said.';

      const result = await model.generateContent([prompt, audioPart]);
      return result.response.text().trim();
    } catch (error: any) {
      logger.error(`Error in transcribeAudio: ${error.message}`);
      throw new Error(`Failed to transcribe audio: ${error.message}`);
    }
  }

  /**
   * Generates 3 distinct style suggestions for a user's matrimony bio.
   */
  static async generateBioSuggestions(profileData: any): Promise<{
    modern: string;
    traditional: string;
    expressive: string;
  }> {
    try {
      const {
        name,
        gender,
        age,
        location,
        occupation,
        interests = [],
        education,
        career,
        familyDetails
      } = profileData;

      const userAge = age || (profileData.dob ? new Date().getFullYear() - new Date(profileData.dob).getFullYear() : 'Not Specified');
      const userCity = location?.city || 'Not Specified';
      const userState = location?.state || 'Not Specified';

      const facts = `
        - Name: ${name}
        - Gender: ${gender}
        - Age: ${userAge}
        - Location: ${userCity}, ${userState}
        - Occupation: ${occupation || career?.occupation || 'Professional'}
        - Employer: ${career?.companyName || 'Not Specified'}
        - Income: ${career?.annualIncome || profileData.income || 'Not Specified'}
        - Education: ${education?.qualification || 'Not Specified'} (${education?.fieldOfStudy || 'Not Specified'}) from ${education?.college || 'Not Specified'}
        - Hobbies/Interests: ${interests.join(', ')}
        - Family background: Father is ${familyDetails?.fatherOccupation || 'Not Specified'}, Mother is ${familyDetails?.motherOccupation || 'Not Specified'}, Family Type: ${familyDetails?.familyType || 'Nuclear'}, Status: ${familyDetails?.familyStatus || 'Middle Class'}
      `;

      if (!genAI) {
        // Return 3 nice dynamic fallback mocks using their profile data if Gemini key is missing
        return {
          modern: `Hi, I'm ${name}, a ${userAge}-year-old ${occupation || 'professional'} based in ${userCity}. I graduated with a degree in ${education?.fieldOfStudy || 'my field'} and currently work at ${career?.companyName || 'my firm'}. Outside of work, I love exploring my interests in ${interests.slice(0, 3).join(', ') || 'new activities'}. I'm looking for a partner who is progressive, career-oriented, and shares a passion for growth and meaningful conversations.`,
          traditional: `Greetings, I am ${name}. Born and raised in ${userState}, I value my family's heritage and principles. I work as a ${occupation || 'professional'} and have been brought up with deep respect for both modern aspirations and family values. My family consists of my parents (Father: ${familyDetails?.fatherOccupation || 'Retired'}, Mother: ${familyDetails?.motherOccupation || 'Homemaker'}) in a ${familyDetails?.familyType || 'nuclear'} household. I am seeking a partner who is family-centric, understanding, and ready to embark on a beautiful life journey together.`,
          expressive: `Hello! I'm ${name}. I believe life is a beautiful canvas of experiences, and my hobbies in ${interests.join(', ') || 'art and travel'} keep me inspired. A ${occupation || 'professional'} by day, but an explorer at heart. I value honesty, mutual respect, and a good sense of humor. I'm looking for an open-minded partner to share laughs, support each other's dreams, and create a warm, loving home.`
        };
      }

      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const prompt = `
        You are an expert matrimonial profile writer for the premium matchmaking app "IraiInai".
        Based on the user's details below, draft 3 distinct, beautiful bio suggestions for their matrimony profile. Each bio must be elegant, family-friendly, and maintain authentic details without inventing new facts.

        User Details:
        ${facts}

        Draft the bios in the following three styles:
        1. "modern": Professional, ambitious, modern-minded, warm, direct.
        2. "traditional": Focuses on family values, respect, cultural roots, traditional matchmaking tone.
        3. "expressive": Artistic, hobby-focused, friendly, outgoing, focusing on life experiences and partnership compatibility.

        Output must be in strict JSON format:
        {
          "modern": "Bio text...",
          "traditional": "Bio text...",
          "expressive": "Bio text..."
        }
      `;

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      });

      const responseText = result.response.text();
      const parsed = JSON.parse(responseText);

      return {
        modern: parsed.modern || '',
        traditional: parsed.traditional || parsed.traditional_family || '',
        expressive: parsed.expressive || parsed.creative || ''
      };
    } catch (error: any) {
      logger.error(`Error in generateBioSuggestions: ${error.message}`);
      // Return standard fallback
      return {
        modern: `Professional based in ${profileData.location?.city || 'India'}. High qualifications and ambitious career goals. Looking for someone compatible.`,
        traditional: `Well-cultured individual with strong family values and respect. Seeking a partner from a similar background.`,
        expressive: `Passionate about interests and hobbies. Looking for a companion to explore life together.`
      };
    }
  }

  // ─── Conversation AI ──────────────────────────────────────────────────────

  /**
   * Generate personalized icebreaker questions/starters for a new match.
   * Uses both profiles to craft highly specific, non-generic openers.
   */
  static async generateIcebreakers(
    myProfile: any,
    theirProfile: any,
    count = 5
  ): Promise<{ question: string; category: string; tone: string }[]> {
    const sharedInterests = (myProfile.interests || []).filter((i: string) =>
      (theirProfile.interests || []).includes(i)
    );

    if (!genAI) {
      // Quality fallback icebreakers using profile data
      const fallbacks = [
        {
          question: `Hi ${theirProfile.name}! I noticed from your profile that you live in ${theirProfile.location?.city || 'your city'}. What's your favourite thing about it?`,
          category: 'profile',
          tone: 'warm',
        },
        {
          question: sharedInterests.length > 0
            ? `Hello! I noticed we both share an interest in ${sharedInterests[0]}. What got you started on it?`
            : `Hello! I see you enjoy learning new things. What's a skill you've been working on lately?`,
          category: 'interests',
          tone: 'curious',
        },
        {
          question: theirProfile.career?.occupation || theirProfile.occupation
            ? `Hi! Being a ${theirProfile.career?.occupation || theirProfile.occupation} sounds very interesting. How did you choose this profession?`
            : `Hello! I'd love to hear more about your professional path and what you work on.`,
          category: 'profession',
          tone: 'genuine',
        },
        {
          question: theirProfile.interests && theirProfile.interests.length > 0
            ? `Hi! I saw you enjoy ${theirProfile.interests[0]}. What do you love most about your hobbies?`
            : `Hello! Outside of your daily routine, what's a hobby you lose track of time doing?`,
          category: 'hobbies',
          tone: 'playful',
        },
        {
          question: `Hello! Family and community values are so important. I noticed you value a ${theirProfile.familyValues || 'moderate'} lifestyle. How do you usually balance tradition and modern values?`,
          category: 'community',
          tone: 'thoughtful',
        },
      ];
      return fallbacks.slice(0, count);
    }

    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const prompt = `
        You are a warm, emotionally intelligent conversation coach for IraiInai, a premium Tamil matrimony app.
        
        Generate exactly ${count} icebreaker conversation starters for a new match. They must feel natural, 
        personal, respectful, and specific — NOT generic. Use details from both profiles below.
        
        My profile:
        - Name: ${myProfile.name}, from ${myProfile.location?.city || 'various'}
        - Occupation: ${myProfile.career?.occupation || myProfile.occupation || 'Professional'}, employed in ${myProfile.career?.employedIn || 'various'}, at ${myProfile.career?.companyName || 'various'}
        - Interests/Hobbies: ${(myProfile.interests || []).join(', ') || 'various'}
        - Community: ${myProfile.religion || 'various'}, ${myProfile.community || 'various'}, mother tongue: ${myProfile.motherTongue || 'Tamil'}
        - Bio: ${myProfile.bio || ''}
        
        Their profile:
        - Name: ${theirProfile.name}, from ${theirProfile.location?.city || 'various'}
        - Occupation: ${theirProfile.career?.occupation || theirProfile.occupation || 'Professional'}, employed in ${theirProfile.career?.employedIn || 'various'}, at ${theirProfile.career?.companyName || 'various'}
        - Interests/Hobbies: ${(theirProfile.interests || []).join(', ') || 'various'}
        - Community: ${theirProfile.religion || 'various'}, ${theirProfile.community || 'various'}, mother tongue: ${theirProfile.motherTongue || 'Tamil'}, family values: ${theirProfile.familyValues || 'various'}
        - Bio: ${theirProfile.bio || ''}
        
        You must generate exactly one opening message for each of the following 5 categories:
        1. "profile": Based on general profile elements like their bio description, city location, or name details.
        2. "interests": Based on shared interests or common connections between you two.
        3. "profession": Based on their occupation, career path, company, or employment details.
        4. "hobbies": Based on their specific hobbies, activities, or what they enjoy doing for fun.
        5. "community": Based on their community traditions, religion, mother tongue, or family values.
        
        Rules:
        - Each must be a genuine question, not a statement
        - Vary tone: curious, playful, warm, thoughtful, genuine
        - Keep each under 25 words
        - Make them feel like something a thoughtful person would actually ask
        - Do NOT use "So," or "Tell me about" openings
        
        Return strict JSON array:
        [
          {"question": "...", "category": "profile|interests|profession|hobbies|community", "tone": "curious|playful|warm|thoughtful|genuine"},
          ...
        ]
      `;

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      });

      const parsed = JSON.parse(result.response.text());
      return Array.isArray(parsed) ? parsed.slice(0, count) : [];
    } catch (error: any) {
      logger.error(`generateIcebreakers error: ${error.message}`);
      return [
        { question: `Hi ${theirProfile.name}! I noticed from your profile that you live in ${theirProfile.location?.city || 'your city'}. What's your favourite thing about it?`, category: 'profile', tone: 'warm' },
        { question: sharedInterests.length > 0 ? `I noticed we both enjoy ${sharedInterests[0]}! What got you into it?` : `What does your ideal weekend look like?`, category: 'interests', tone: 'curious' },
        { question: `Being a ${theirProfile.career?.occupation || theirProfile.occupation || 'Professional'} sounds fascinating — what do you love most about your work?`, category: 'profession', tone: 'genuine' },
        { question: `Outside of your daily routine, what's a hobby you lose track of time doing?`, category: 'hobbies', tone: 'playful' },
        { question: `I noticed you value a ${theirProfile.familyValues || 'moderate'} lifestyle. How do you balance tradition and modern values?`, category: 'community', tone: 'thoughtful' }
      ];
    }
  }

  /**
   * Generate smart reply suggestions based on the last received message and conversation context.
   * Returns short, natural replies the user can tap to send.
   */
  static async suggestReplies(
    lastMessage: string,
    conversationHistory: { sender: 'me' | 'them'; text: string }[],
    myProfile: any,
    theirProfile: any,
    count = 3
  ): Promise<{ text: string; tone: string }[]> {
    if (!lastMessage?.trim()) return [];

    if (!genAI) {
      // Smart contextual fallbacks
      const isQuestion = lastMessage.includes('?');
      const fallbacks = isQuestion
        ? [
            { text: 'That\'s a great question! Let me think...', tone: 'thoughtful' },
            { text: 'Honestly, I love it! What about you?', tone: 'warm' },
            { text: 'Haha, never thought about it that way!', tone: 'playful' },
          ]
        : [
            { text: 'That sounds lovely!', tone: 'warm' },
            { text: 'I can relate to that completely.', tone: 'genuine' },
            { text: 'Tell me more about that!', tone: 'curious' },
          ];
      return fallbacks.slice(0, count);
    }

    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const recentHistory = conversationHistory.slice(-6).map(m =>
        `${m.sender === 'me' ? myProfile.name : theirProfile.name}: ${m.text}`
      ).join('\n');

      const prompt = `
        You are a warm, emotionally intelligent conversation assistant for a matrimony app.
        
        Context:
        - My name: ${myProfile.name}
        - Their name: ${theirProfile.name}
        
        Recent conversation:
        ${recentHistory}
        
        Their latest message: "${lastMessage}"
        
        Generate exactly ${count} short, natural reply options I could send. Each reply should:
        - Be under 15 words
        - Sound like something a real person would type (not a chatbot)
        - Be authentic and culturally appropriate for an Indian matrimony context
        - Vary in tone: warm/playful/thoughtful/curious/genuine
        - NOT start with "I" every time
        - NOT be sycophantic ("That's amazing!" every time)
        
        Return strict JSON array:
        [
          {"text": "Short reply here", "tone": "warm|playful|thoughtful|curious|genuine"},
          ...
        ]
      `;

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      });

      const parsed = JSON.parse(result.response.text());
      return Array.isArray(parsed) ? parsed.slice(0, count) : [];
    } catch (error: any) {
      logger.error(`suggestReplies error: ${error.message}`);
      return [
        { text: 'That\'s really interesting!', tone: 'warm' },
        { text: 'Tell me more about that.', tone: 'curious' },
        { text: 'Haha, I can relate!', tone: 'playful' },
      ];
    }
  }

  /**
   * Analyse conversation history and generate personalised coaching tips.
   * Helps users have deeper, more meaningful conversations.
   */
  static async generateConversationTips(
    conversationHistory: { sender: 'me' | 'them'; text: string }[],
    myProfile: any,
    theirProfile: any
  ): Promise<{
    tips: { title: string; description: string; emoji: string; priority: 'high' | 'medium' | 'low' }[];
    overallTone: string;
    suggestedTopic: string;
  }> {
    const defaultResponse = {
      tips: [
        {
          title: 'Ask about their passions',
          description: `${theirProfile.name} has interests in ${(theirProfile.interests || []).slice(0, 2).join(' and ') || 'various topics'} — explore those!`,
          emoji: '❤️',
          priority: 'high' as const,
        },
        {
          title: 'Share something personal',
          description: 'Vulnerability builds trust. Share a small personal story or childhood memory.',
          emoji: '🌱',
          priority: 'medium' as const,
        },
        {
          title: 'Use their name occasionally',
          description: 'Addressing someone by name feels warm and attentive in written conversation.',
          emoji: '✨',
          priority: 'low' as const,
        },
      ],
      overallTone: 'Getting started',
      suggestedTopic: theirProfile.interests?.[0] || 'their hometown',
    };

    if (!conversationHistory.length) return defaultResponse;

    if (!genAI) return defaultResponse;

    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const historyText = conversationHistory.slice(-10).map(m =>
        `${m.sender === 'me' ? 'Me' : theirProfile.name}: ${m.text}`
      ).join('\n');

      const prompt = `
        You are an expert relationship communication coach for a premium Indian matrimony app.
        
        Analyse this conversation between ${myProfile.name} and ${theirProfile.name} and provide personalised tips.
        
        Conversation:
        ${historyText}
        
        Their profile details:
        - Interests: ${(theirProfile.interests || []).join(', ') || 'Not listed'}
        - Occupation: ${theirProfile.career?.occupation || theirProfile.occupation || 'Professional'}
        - City: ${theirProfile.location?.city || 'India'}
        
        Provide:
        1. 3 specific, actionable conversation tips (NOT generic advice)
        2. The overall tone/health of the conversation so far (1 phrase, e.g. "Warm and curious", "Surface-level", "Building momentum")
        3. One specific topic to explore next based on their profile
        
        Return strict JSON:
        {
          "tips": [
            {"title": "Short tip title", "description": "1-2 sentence actionable tip", "emoji": "relevant emoji", "priority": "high|medium|low"},
            ...
          ],
          "overallTone": "Phrase describing conversation tone",
          "suggestedTopic": "Specific topic to bring up next"
        }
      `;

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      });

      const parsed = JSON.parse(result.response.text());
      return {
        tips: parsed.tips?.slice(0, 3) || defaultResponse.tips,
        overallTone: parsed.overallTone || 'Friendly',
        suggestedTopic: parsed.suggestedTopic || defaultResponse.suggestedTopic,
      };
    } catch (error: any) {
      logger.error(`generateConversationTips error: ${error.message}`);
      return defaultResponse;
    }
  }

  /**
   * Analyse conversation health: momentum, balance, sentiment, depth score.
   */
  static async analyzeConversationHealth(
    conversationHistory: { sender: 'me' | 'them'; text: string; timestamp: string }[]
  ): Promise<{
    momentum: 'growing' | 'stable' | 'slowing' | 'stalled';
    balance: number;          // 0-100, 50 = perfect balance of who talks more
    sentimentScore: number;   // 0-100
    depthScore: number;       // 0-100, surface vs meaningful topics
    summary: string;
  }> {
    const myMessages = conversationHistory.filter(m => m.sender === 'me');
    const theirMessages = conversationHistory.filter(m => m.sender === 'them');
    const total = conversationHistory.length;

    const balance = total > 0 ? Math.round((myMessages.length / total) * 100) : 50;

    if (!genAI || total < 4) {
      return {
        momentum: total < 2 ? 'stalled' : 'growing',
        balance,
        sentimentScore: 72,
        depthScore: 40,
        summary: total < 2 ? 'Just getting started!' : 'Conversation is flowing nicely.',
      };
    }

    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const historyText = conversationHistory.slice(-15).map(m =>
        `${m.sender === 'me' ? 'Me' : 'Them'}: ${m.text}`
      ).join('\n');

      const prompt = `
        Analyse this chat conversation health for a matrimony app.
        
        ${historyText}
        
        Return strict JSON:
        {
          "momentum": "growing|stable|slowing|stalled",
          "sentimentScore": <0-100, 100=very positive>,
          "depthScore": <0-100, 100=deep meaningful topics>,
          "summary": "1 sentence summary of conversation health"
        }
      `;

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      });

      const parsed = JSON.parse(result.response.text());
      return {
        momentum: parsed.momentum || 'stable',
        balance,
        sentimentScore: parsed.sentimentScore ?? 70,
        depthScore: parsed.depthScore ?? 50,
        summary: parsed.summary || 'Conversation is progressing well.',
      };
    } catch (error: any) {
      logger.error(`analyzeConversationHealth error: ${error.message}`);
      return { momentum: 'stable', balance, sentimentScore: 70, depthScore: 50, summary: 'Conversation is progressing.' };
    }
  }

  /**
   * Interactive AI Relationship Assistant Chatbot
   */
  static async chatWithAssistant(
    userMessage: string,
    sessionHistory: { role: 'user' | 'assistant'; text: string }[],
    myProfile: any,
    partnerProfile?: any
  ): Promise<string> {
    if (!genAI) {
      return "I'm currently operating in offline fallback mode, but I'm here to support you! What specific relationship advice are you looking for today?";
    }

    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      
      const historyPrompt = sessionHistory.map(m => 
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`
      ).join('\n');

      let contextStr = `
        User Context:
        - Name: ${myProfile.name}
        - Gender: ${myProfile.gender}
        - Age: ${new Date().getFullYear() - new Date(myProfile.dob).getFullYear()}
        - Occupation: ${myProfile.career?.occupation || myProfile.occupation || 'Professional'}
        - Interests: ${(myProfile.interests || []).join(', ')}
      `;

      if (partnerProfile) {
        contextStr += `
        Match Partner Context:
        - Name: ${partnerProfile.name}
        - Gender: ${partnerProfile.gender}
        - Age: ${new Date().getFullYear() - new Date(partnerProfile.dob).getFullYear()}
        - Occupation: ${partnerProfile.career?.occupation || partnerProfile.occupation || 'Professional'}
        - Interests: ${(partnerProfile.interests || []).join(', ')}
        `;
      }

      const prompt = `
        You are the "Love Coach", an expert relationship and matchmaking AI assistant for the premium Indian matrimony app "IraiInai".
        Your goal is to provide warm, culturally appropriate, empathetic, and actionable advice to the user.
        You should act like a supportive friend who is also a professional counselor.
        
        ${contextStr}
        
        Previous Conversation History:
        ${historyPrompt}
        
        User's New Message: "${userMessage}"
        
        Provide a helpful, concise (under 100 words), and conversational response to the user.
      `;

      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch (error: any) {
      logger.error(`chatWithAssistant error: ${error.message}`);
      return "I'm having a little trouble connecting right now, but I want to make sure I give you the best advice. Could you try asking again in a moment?";
    }
  }
}
