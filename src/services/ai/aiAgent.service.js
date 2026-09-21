// const { OpenAI } = require("openai");
// const env = require("../../config/env");
// const storageService = require("../../db/storageService");
// const { tools, executeTool } = require("./aiTools");
// const { SYSTEM_PROMPT } = require("./aiPrompt");

// const MAX_HISTORY_MESSAGES = 16;
// const MAX_TOOL_ITERATIONS = 5;

// const conversations = new Map(); // phone -> { history: [], cart: [] }

// const getConversation = (phone) => {
//   const normalized = storageService.normalizePhone(phone) || phone;
//   if (!conversations.has(normalized)) {
//     conversations.set(normalized, { history: [], cart: [] });
//   }
//   return conversations.get(normalized);
// };

// const resetConversation = (phone) => {
//   const normalized = storageService.normalizePhone(phone) || phone;
//   conversations.delete(normalized);
//   return getConversation(normalized);
// };

// const trimHistory = (history) =>
//   history.length > MAX_HISTORY_MESSAGES ? history.slice(history.length - MAX_HISTORY_MESSAGES) : history;

// const getOpenAIClient = () => {
//   if (!env.openai.apiKey) {
//     throw new Error("OPENAI_API_KEY is not configured");
//   }
//   return new OpenAI({ apiKey: env.openai.apiKey });
// };

// const generateReply = async ({ customerPhone, customerName, message }) => {
//   const client = getOpenAIClient();
//   const normalizedPhone = storageService.normalizePhone(customerPhone) || customerPhone;
//   const convo = getConversation(normalizedPhone);

//   convo.history.push({ role: "user", content: message });
//   convo.history = trimHistory(convo.history);

//   const messages = [{ role: "system", content: SYSTEM_PROMPT(customerName) }, ...convo.history];

//   let finalReplyText = null;
//   let iterations = 0;

//   while (iterations < MAX_TOOL_ITERATIONS && finalReplyText === null) {
//     iterations += 1;

//     const completion = await client.chat.completions.create({
//       model: env.openai.model || "gpt-4o-mini",
//       messages,
//       tools,
//       tool_choice: "auto",
//       temperature: 0.4,
//     });

//     const assistantMessage = completion.choices[0].message;
//     messages.push(assistantMessage);

//     const toolCalls = assistantMessage.tool_calls;
//     if (!toolCalls || toolCalls.length === 0) {
//       finalReplyText = assistantMessage.content || "Sorry, could you rephrase that?";
//       break;
//     }

//     for (const toolCall of toolCalls) {
//       let args = {};
//       try {
//         args = JSON.parse(toolCall.function.arguments || "{}");
//       } catch (e) {
//         args = {};
//       }

//       let toolResult;
//       try {
//         toolResult = await executeTool(toolCall.function.name, args, {
//           phone: normalizedPhone,
//           customerName,
//           conversation: convo,
//         });
//       } catch (toolError) {
//         toolResult = { error: toolError.message || "Tool execution failed" };
//       }

//       messages.push({
//         role: "tool",
//         tool_call_id: toolCall.id,
//         content: JSON.stringify(toolResult),
//       });
//     }
//   }

//   if (finalReplyText === null) {
//     finalReplyText = "Sorry, I'm having trouble processing that right now — let me get a team member to help you.";
//   }

//   convo.history.push({ role: "assistant", content: finalReplyText });
//   convo.history = trimHistory(convo.history);

//   return { reply: finalReplyText };
// };

// module.exports = { generateReply, getConversation, resetConversation };




//testing



const { GoogleGenAI } = require("@google/genai");
const env = require("../../config/env");
const storageService = require("../../db/storageService");
const { toolDeclarations, executeTool } = require("./aiTools");
const { SYSTEM_PROMPT } = require("./aiPrompt");

const MAX_HISTORY_ENTRIES = 24;
const MAX_TOOL_ITERATIONS = 5;

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

    const response = await ai.models.generateContent({
      // model: env.gemini.model || "gemini-2.5-flash",
      model: env.gemini.model || "gemini-3.6-flash",
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT(customerName),
        tools: [{ functionDeclarations: toolDeclarations }],
      },
    });

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

    // contents.push({ role: "function", parts: functionResponseParts });

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