import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export const detectHighlights = async (title: string, description: string) => {
  const prompt = `Analyze this video metadata and suggest the most viral/engaging segment (15-60s) for a YouTube Short.
  Title: ${title}
  Description: ${description}
  
  Return a start time in seconds.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          startTime: { type: Type.NUMBER, description: "Start time in seconds" },
          reasoning: { type: Type.STRING, description: "Why this part?" },
          suggestedTitle: { type: Type.STRING, description: "A catchy title for the short" }
        },
        required: ["startTime", "suggestedTitle"]
      }
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    return { startTime: 30, suggestedTitle: "Amazing Highlight" };
  }
};
