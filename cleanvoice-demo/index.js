import { Cleanvoice } from '@cleanvoice/cleanvoice-sdk';
import dotenv from 'dotenv';

dotenv.config();

// Ensure the API key is provided
if (!process.env.CLEANVOICE_API_KEY) {
  console.error("Error: CLEANVOICE_API_KEY is not defined in the .env file.");
  process.exit(1);
}

const cv = new Cleanvoice({
  apikey: process.env.CLEANVOICE_API_KEY
});

async function runDemo() {
  try {
    console.log("Sending request to Cleanvoice AI...");
    
    // Using the exact example from the Cleanvoice dashboard
    const { audio } = await cv.process(
      "https://cdn.cleanvoice.ai/assets/sample.mp3",
      {
        normalize: true,
        studio_sound: true
      }
    );

    console.log('Successfully cleaned audio. URL: ' + audio.url);
  } catch (error) {
    console.error("An error occurred during processing:", error);
  }
}

runDemo();
