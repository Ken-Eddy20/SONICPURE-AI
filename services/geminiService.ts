
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { blobToBase64, decodeBase64 } from "./audioUtils";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export async function processAudioWithGemini(
  audioBlob: Blob,
  intensity: number
): Promise<{ cleanedAudioBytes: Uint8Array; message: string }> {
  const base64Data = await blobToBase64(audioBlob);
  
  // Dynamic prompt based on intensity
  let promptInstruction = "";
  if (intensity < 30) {
    promptInstruction = "Gently remove background static and low-level hiss. Keep the voice very natural, prioritize clarity over total silence in pauses.";
  } else if (intensity < 70) {
    promptInstruction = "Noticeably reduce background noise like air conditioning, distant traffic, and computer fans. Ensure the primary speaker's voice remains clear and warm.";
  } else {
    promptInstruction = "Aggressively remove almost all background noise. Isolate the primary voice or sound signal completely. Ensure silence during pauses while maintaining voice texture.";
  }

  const prompt = `Task: Professional Audio Noise Reduction.
  Instruction: ${promptInstruction}
  Output: Return only the processed audio. Do not change the pitch or speed. Maintain the natural characteristics of the audio source while eliminating the noise.`;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      contents: {
        parts: [
          { inlineData: { data: base64Data, mimeType: audioBlob.type } },
          { text: prompt }
        ]
      },
    });

    const audioPart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
    const textPart = response.candidates?.[0]?.content?.parts.find(p => p.text);

    if (!audioPart || !audioPart.inlineData) {
      throw new Error("No audio was returned by the model.");
    }

    const cleanedAudioBytes = decodeBase64(audioPart.inlineData.data);
    
    return {
      cleanedAudioBytes,
      message: textPart?.text || "Audio processed successfully."
    };
  } catch (error: any) {
    console.error("Gemini Processing Error:", error);
    throw error;
  }
}
