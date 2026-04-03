
export interface AudioState {
  originalBlob: Blob | null;
  processedBlob: Blob | null;
  isProcessing: boolean;
  removeNoise: boolean;
  fillers: boolean;
  stutters: boolean;
  mouthSounds: boolean;
  hesitations: boolean;
  breath: boolean;
  normalize: boolean;
}

export enum ProcessIntensity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  EXTREME = 'EXTREME'
}

export interface AudioMetadata {
  name: string;
  size: string;
  duration: number;
}
