import { GoogleGenAI } from "@google/genai";
// .env defines GEMINI_API_KEY, and newsletter-summary.ts gates on that same
// name — reading only GOOGLE_API_KEY here left the client with an empty key, so
// every call went out unauthenticated and came back 403 PERMISSION_DENIED
// ("Method doesn't allow unregistered callers").
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
});
export default ai;