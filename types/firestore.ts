import { Timestamp } from 'firebase/firestore';

export interface CreditPlanDocument {
  planId: string;
  name: string;
  tagline: string;
  price: number;
  billingCycle: 'monthly' | 'one_time';
  credits: number;
  creditsExpire?: boolean;
  isUnlimited: boolean;
  maxDailyEnhances: number;
  maxAudioLengthMins: number;
  processingSpeed: 'standard' | 'high_priority' | 'highest_tier';
  extractAudioFromVideo: boolean;
  multipleUploads: boolean;
  advancedNoiseProfiles: boolean;
  isActive: boolean;
}

export interface UserDocument {
  email: string;
  displayName: string;
  plan: 'free' | 'payg' | 'pro' | 'unlimited';
  credits: number;
  creditsUsedThisMonth: number;
  dailyEnhancesUsed: number;
  dailyEnhancesResetAt: Timestamp;
  createdAt: Timestamp;
  billingRenewDate: Timestamp;
  paystackCustomerId: string | null;
  isActive: boolean;
}

export interface TransactionDocument {
  userId: string;
  paystackReference: string;
  amountPaid: number;
  currency: string;
  creditsAdded: number;
  plan: string;
  status: 'success' | 'failed' | 'pending';
  createdAt: Timestamp;
}

export interface UsageLogDocument {
  userId: string;
  feature: 'noise_removal' | 'audio_enhancement' | 'voice_clarity';
  fileName: string;
  fileDurationSeconds: number;
  creditsUsed: number;
  status: 'completed' | 'failed' | 'processing';
  createdAt: Timestamp;
}

export interface AudioFileDocument {
  userId: string;
  originalFileName: string;
  originalFileUrl: string;
  originalPublicId: string;
  processedFileUrl: string | null;
  processedPublicId: string | null;
  extractedAudioUrl: string | null;
  extractedPublicId: string | null;
  sourceType: 'audio' | 'video';
  feature: 'noise_removal' | 'audio_enhancement' | 'voice_clarity';
  fileSizeMB: number;
  durationSeconds: number;
  status: 'uploading' | 'processing' | 'processed' | 'failed';
  createdAt: Timestamp;
  expiresAt: Timestamp;
}
