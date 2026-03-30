
export interface AudioState {
  originalBlob: Blob | null;
  processedBlob: Blob | null;
  isProcessing: boolean;
  intensity: number;
  autoBalance?: boolean;
  autoGain?: boolean;
  dereverberation?: boolean;
  audioRestoration?: boolean;
  aggressive?: boolean;
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
