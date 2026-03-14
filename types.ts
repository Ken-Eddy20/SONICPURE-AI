
export interface AudioState {
  originalBlob: Blob | null;
  processedBlob: Blob | null;
  isProcessing: boolean;
  intensity: number;
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
