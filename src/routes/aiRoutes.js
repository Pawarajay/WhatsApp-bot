const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");

router.post("/reply", aiController.handleAIReply);

module.exports = router;

