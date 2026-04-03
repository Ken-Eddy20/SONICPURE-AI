/**
 * Calculate credits needed for an audio processing job.
 * Base: ~4 credits per minute. Higher intensity = more credits.
 * @param durationSeconds - Audio duration in seconds
 * @param intensity - Noise removal intensity 0-100
 * @returns Credits required (minimum 4 for short clips)
 */
export function calculateCreditsForProcessing(durationSeconds: number): number {
  const durationMinutes = durationSeconds / 60;
  // Base: 4 credits per minute
  const creditsPerMinute = 4;
  const credits = Math.ceil(durationMinutes * creditsPerMinute);
  return Math.max(4, credits); // Minimum 4 credits per job
}
