const aiAgentService = require("./ai/aiAgent.service");

const generateAIReply = async ({ customerPhone, customerName, message }) => {
  return await aiAgentService.generateReply({ customerPhone, customerName, message });
};

module.exports = {
  generateAIReply,
  getSession: aiAgentService.getConversation,
  resetSession: aiAgentService.resetConversation,
};