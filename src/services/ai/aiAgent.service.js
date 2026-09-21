const { GoogleGenAI } = require("@google/genai");
const env = require("../../config/env");
const storageService = require("../../db/storageService");
const { toolDeclarations, executeTool } = require("./aiTools");
const { SYSTEM_PROMPT } = require("./aiPrompt");

const MAX_HISTORY_ENTRIES = 24;
const MAX_TOOL_ITERATIONS = 5;
// const MAX_RETRIES = 2;
const MAX_RETRIES = 4;


const conversations = new Map(); // phone -> { history: [] (Gemini "contents"), cart: [] }

const getConversation = (phone) => {
  const normalized = storageService.normalizePhone(phone) || phone;
  if (!conversations.has(normalized)) {
    conversations.set(normalized, { history: [], cart: [] });
  }
  return conversations.get(normalized);
};

const resetConversation = (phone) => {
  const normalized = storageService.normalizePhone(phone) || phone;
  conversations.delete(normalized);
  return getConversation(normalized);
};

const trimHistory = (history) =>
  history.length > MAX_HISTORY_ENTRIES ? history.slice(history.length - MAX_HISTORY_ENTRIES) : history;

let client = null;
const getClient = () => {
  if (!env.gemini.apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: env.gemini.apiKey });
  }
  return client;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryable = (error) => {
  const msg = error?.message || "";
  return msg.includes("UNAVAILABLE") || msg.includes("503") || msg.includes("overloaded");
};

const callGeminiWithRetry = async (ai, params) => {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (error) {
      if (attempt < MAX_RETRIES && isRetryable(error)) {
        console.warn(`Gemini call failed (attempt ${attempt + 1}), retrying:`, error.message);
        // await sleep(1000 * (attempt + 1)); // 1s, then 2s
        await sleep(1500 * Math.pow(2, attempt)); // 1.5s, 3s, 6s, 12s
        continue;
      }
      throw error;
    }
  }
};

const generateReply = async ({ customerPhone, customerName, message }) => {
  const ai = getClient();
  const normalizedPhone = storageService.normalizePhone(customerPhone) || customerPhone;
  const convo = getConversation(normalizedPhone);

  convo.history.push({ role: "user", parts: [{ text: message }] });
  convo.history = trimHistory(convo.history);

  const contents = [...convo.history];
  let finalReplyText = null;
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS && finalReplyText === null) {
    iterations += 1;

    let response;
    try {
      response = await callGeminiWithRetry(ai, {
        model: env.gemini.model || "gemini-3.6-flash",
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT(customerName),
          tools: [{ functionDeclarations: toolDeclarations }],
        },
      });
    } catch (error) {
      console.error("Gemini call failed after retries:", error.message);
      finalReplyText =
        "Sorry, our assistant is a bit busy right now — please try again in a moment, or a team member will follow up with you.";
      break;
    }

    const candidateContent = response.candidates?.[0]?.content;
    if (candidateContent) {
      contents.push(candidateContent);
    }

    const functionCalls = response.functionCalls || [];

    if (functionCalls.length === 0) {
      finalReplyText = response.text || "Sorry, could you rephrase that?";
      break; // contents already includes this final model turn
    }

    const functionResponseParts = [];
    for (const call of functionCalls) {
      let toolResult;
      try {
        // Gemini gives args as a structured object already — no JSON.parse needed
        toolResult = await executeTool(call.name, call.args || {}, {
          phone: normalizedPhone,
          customerName,
          conversation: convo,
        });
      } catch (toolError) {
        toolResult = { error: toolError.message || "Tool execution failed" };
      }

      functionResponseParts.push({
        functionResponse: {
          name: call.name,
          response: toolResult,
        },
      });
    }

    // Gemini expects the function result back with role "user", not "function"
    contents.push({ role: "user", parts: functionResponseParts });
  }

  if (finalReplyText === null) {
    finalReplyText = "Sorry, I'm having trouble processing that right now — let me get a team member to help you.";
    contents.push({ role: "model", parts: [{ text: finalReplyText }] });
  }

  convo.history = trimHistory(contents);

  return { reply: finalReplyText };
};

module.exports = { generateReply, getConversation, resetConversation };