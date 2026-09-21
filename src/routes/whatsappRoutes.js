const express = require("express");
const router = express.Router();
const whatsappController = require("../controllers/whatsappController");

router.post("/send", whatsappController.sendMessage);
router.get("/webhook", whatsappController.verifyWebhook);
router.post("/webhook", whatsappController.handleWebhookPayload);
router.get("/conversations", whatsappController.getConversations);
router.get("/conversations/:phone/messages", whatsappController.getConversationMessages);
router.get("/logs", whatsappController.getMessageLogs);
router.get("/messages", whatsappController.getMessageLogs);
router.get("/status", whatsappController.getStatus);
router.post("/simulate-incoming", whatsappController.simulateIncomingMessage);

module.exports = router;
