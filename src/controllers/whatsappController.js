const whatsappService = require("../services/whatsappService");
const openaiService = require("../services/openaiService");
const woocommerceService = require("../services/woocommerceService");
const storageService = require("../db/storageService");

// ---------------------------------------------------------------------------
// Bounded deduplication cache (max 1000 message IDs, FIFO eviction)
// ---------------------------------------------------------------------------

const MAX_DEDUP_SIZE = 1000;
const processedIds = [];
const processedSet = new Set();

const isDuplicate = (messageId) => {
  if (!messageId) return false;
  if (processedSet.has(messageId)) return true;

  processedSet.add(messageId);
  processedIds.push(messageId);

  // Evict oldest when exceeding max size
  while (processedIds.length > MAX_DEDUP_SIZE) {
    const oldest = processedIds.shift();
    processedSet.delete(oldest);
  }

  return false;
};

// ---------------------------------------------------------------------------
// Process incoming WhatsApp message → AI reply → send back
// ---------------------------------------------------------------------------

const processIncomingMessage = async (from, text, profileName, messageId = null) => {
  // 1. Save incoming customer message
  await storageService.saveIncomingMessage(from, profileName, text, messageId);

  // 2. Generate AI reply with product catalog context
  let catalog = [];
  try {
    catalog = await woocommerceService.getProducts();
  } catch (error) {
    console.error("Could not fetch product catalog for AI context:", error.message);
  }

  const aiResult = await openaiService.generateAIReply({
    customerPhone: from,
    customerName: profileName,
    message: text,
    productsCatalog: catalog,
  });

  // 3. Save AI reply to storage
  await storageService.saveOutgoingMessage(from, aiResult.reply, true);

  // 4. Send AI reply to customer via WhatsApp
  try {
    await whatsappService.sendTextMessage(from, aiResult.reply);
  } catch (sendError) {
    console.error(
      `Failed to send WhatsApp reply to ${from}:`,
      sendError.message,
    );
    // Message is still saved in storage — admin can see it in the inbox
  }
};

// ---------------------------------------------------------------------------
// POST /api/whatsapp/send — Admin sends a message from the inbox UI
// ---------------------------------------------------------------------------

const sendMessage = async (req, res) => {
  try {
    const { to, text, name } = req.body;
    if (!to || !text) {
      return res.status(400).json({
        success: false,
        message: "Missing 'to' (phone number) or 'text' field",
      });
    }

    // Save outgoing message (admin manual, not AI) with customer name
    await storageService.saveOutgoingMessage(to, text, false, name);

    // Try to send via WhatsApp provider
    let sendResult = null;
    try {
      sendResult = await whatsappService.sendTextMessage(to, text);
    } catch (sendError) {
      console.error("WhatsApp send failed:", sendError.message);
      // Message is saved locally — return success with a warning
      return res.json({
        success: true,
        message: "Message saved. WhatsApp delivery pending — provider may not be configured.",
        warning: sendError.message,
      });
    }

    res.json({
      success: true,
      message: "Message sent",
      data: sendResult,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || "WHATSAPP_SEND_FAILED",
      message: error.message || "Failed to send WhatsApp message",
    });
  }
};

// ---------------------------------------------------------------------------
// GET /api/whatsapp/webhook — Meta/AOC webhook verification
// ---------------------------------------------------------------------------

const verifyWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // 1. If Meta or AOC sends challenge parameters during verification
  if (mode && token) {
    const challengeResult = whatsappService.verifyWebhook(mode, token, challenge);
    if (challengeResult) {
      console.log("WhatsApp Webhook verified successfully.");
      return res.status(200).send(challengeResult);
    }
    return res.status(403).send("Forbidden: Invalid verification token");
  }

  // 2. If opened directly in a browser (without query params), show friendly status
  return res.status(200).json({
    success: true,
    message: "WhatsApp Webhook Endpoint is LIVE and healthy! Configure this URL in your AOC portal.",
    status: "READY",
    timestamp: new Date().toISOString(),
  });
};

// ---------------------------------------------------------------------------
// POST /api/whatsapp/webhook — Incoming message from customer
// Supports both Meta Cloud API structure and flat AOC/BSP formats
// ---------------------------------------------------------------------------

const handleWebhookPayload = (req, res) => {
  try {
    const body = req.body;
    let from = null;
    let text = null;
    let profileName = "";
    let messageId = null;

    console.log("Incoming Webhook Payload:", JSON.stringify(body));

    if (body?.object) {
      // 1. Standard Meta Cloud API format
      const value = body.entry?.[0]?.changes?.[0]?.value;
      const messageObj = value?.messages?.[0];
      const contactObj = value?.contacts?.[0];

      if (messageObj) {
        messageId = messageObj.id;
        from = messageObj.from;
        text =
          messageObj.text?.body ||
          messageObj.button?.text ||
          messageObj.interactive?.button_reply?.title ||
          messageObj.interactive?.list_reply?.title;

        // Capture media, voice, documents, and locations
        if (!text) {
          if (messageObj.image) text = messageObj.image.caption || "📷 [Photo]";
          else if (messageObj.video) text = messageObj.video.caption || "🎥 [Video]";
          else if (messageObj.audio) text = "🎵 [Voice Note/Audio]";
          else if (messageObj.document) text = messageObj.document.filename ? `📄 [Document: ${messageObj.document.filename}]` : "📄 [Document]";
          else if (messageObj.location) text = "📍 [Location]";
          else if (messageObj.sticker) text = "🏷️ [Sticker]";
          else if (messageObj.type) text = `[${messageObj.type} message]`;
        }
        profileName = contactObj?.profile?.name || "";
      }
    } else {
      // 2. AOC / BSP Webhook Format
      messageId = body.messageId || body.id || null;

      // Extract Customer Name
      profileName =
        body.contacts?.profileName ||
        body.contacts?.name ||
        body.profileName ||
        body.name ||
        body.userName ||
        "";

      // Extract Message Text (handles messages.text.body, flat text, buttons, etc.)
      text =
        body.messages?.text?.body ||
        body.messages?.[0]?.text?.body ||
        (typeof body.messages?.text === "string" ? body.messages?.text : null) ||
        body.messages?.interactive?.button_reply?.title ||
        body.messages?.interactive?.list_reply?.title ||
        body.messages?.button?.text ||
        (typeof body.message === "object" ? body.message?.text : body.message) ||
        body.text ||
        body.body ||
        body.caption ||
        "";

      // Capture AOC media / location
      if (!text && (body.mediaUrl || body.image || body.media)) {
        text = body.caption || "📷 [Media]";
      } else if (!text && body.location) {
        text = "📍 [Location]";
      } else if (!text && (body.type || body.messageType)) {
        text = `[${body.type || body.messageType} message]`;
      }

      // Resolve Customer Phone Number
      const myBusinessNumber = storageService.normalizePhone(
        process.env.WHATSAPP_FROM || "919321089761",
      );
      const candidateRecipient = storageService.normalizePhone(
        body.contacts?.recipient,
      );
      const candidateFrom = storageService.normalizePhone(
        body.from || body.mobile || body.sender || body.phone,
      );

      if (candidateRecipient && candidateRecipient !== myBusinessNumber) {
        from = candidateRecipient;
      } else if (candidateFrom && candidateFrom !== myBusinessNumber) {
        from = candidateFrom;
      } else {
        from = candidateRecipient || candidateFrom;
      }
    }

    if (from && text) {
      // Bounded deduplication
      if (messageId && isDuplicate(messageId)) {
        return res.status(200).send("EVENT_RECEIVED");
      }

      console.log(
        `Incoming WhatsApp message from ${from} (${profileName || "unknown"}): ${text}`,
      );

      processIncomingMessage(from, text, profileName, messageId).catch((error) => {
        console.error(
          "Incoming WhatsApp processing failed:",
          error.message,
        );
      });

      return res.status(200).send("EVENT_RECEIVED");
    }

    // Acknowledge webhook delivery even for status receipts
    return res.status(200).send("EVENT_RECEIVED");
  } catch (error) {
    console.error("Webhook processing error:", error.message);
    return res.status(500).send("Internal Server Error");
  }
};

// ---------------------------------------------------------------------------
// GET /api/whatsapp/conversations — List all conversations
// ---------------------------------------------------------------------------

const getConversations = async (req, res) => {
  try {
    const conversations = await storageService.getConversations();
    res.json({
      success: true,
      data: conversations,
      count: conversations.length,
    });
  } catch (error) {
    console.error("Failed to fetch conversations:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch conversations",
    });
  }
};

// ---------------------------------------------------------------------------
// GET /api/whatsapp/conversations/:phone/messages — Get message thread
// ---------------------------------------------------------------------------

const getConversationMessages = async (req, res) => {
  try {
    const phone = req.params.phone;
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    const messages = await storageService.getMessagesByPhone(phone);

    // Mark conversation as read when admin views it
    await storageService.markConversationRead(phone);

    res.json({
      success: true,
      data: messages,
      count: messages.length,
    });
  } catch (error) {
    console.error("Failed to fetch messages:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch messages",
    });
  }
};

// ---------------------------------------------------------------------------
// GET /api/whatsapp/status — WhatsApp connection status
// ---------------------------------------------------------------------------

const getStatus = (req, res) => {
  const status = whatsappService.getConnectionStatus();
  res.json({ success: true, data: status });
};

// ---------------------------------------------------------------------------
// GET /api/whatsapp/logs — Get all message logs (Name, Phone, Text, Timestamp)
// ---------------------------------------------------------------------------

const getMessageLogs = async (req, res) => {
  try {
    const logs = await storageService.getAllMessageLogs();
    res.json({
      success: true,
      data: logs,
      count: logs.length,
    });
  } catch (error) {
    console.error("Failed to fetch message logs:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch message logs",
    });
  }
};

// ---------------------------------------------------------------------------
// POST /api/whatsapp/simulate-incoming — Test incoming message without live webhook
// ---------------------------------------------------------------------------

const simulateIncomingMessage = async (req, res) => {
  try {
    const { from, name, text } = req.body;
    if (!from || !text) {
      return res.status(400).json({
        success: false,
        message: "Missing 'from' (phone number) or 'text' message",
      });
    }

    const profileName = name || "Customer";
    await processIncomingMessage(from, text, profileName);

    res.json({
      success: true,
      message: `Simulated incoming message from ${profileName} (${from}) processed successfully`,
    });
  } catch (error) {
    console.error("Simulation error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to simulate incoming message",
    });
  }
};

module.exports = {
  sendMessage,
  verifyWebhook,
  handleWebhookPayload,
  getConversations,
  getConversationMessages,
  getMessageLogs,
  getStatus,
  simulateIncomingMessage,
};
