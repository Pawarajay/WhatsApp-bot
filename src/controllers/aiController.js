const openaiService = require("../services/openaiService");
const woocommerceService = require("../services/woocommerceService");

const handleAIReply = async (req, res) => {
  try {
    const { customerPhone, message } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Message content is required",
      });
    }

    // Attempt to fetch current products catalog from WooCommerce to pass real prices to AI
    let productsCatalog = [];
    try {
      productsCatalog = await woocommerceService.getProducts();
    } catch (e) {
      return res.status(503).json({
        success: false,
        code: "PRODUCT_CATALOG_UNAVAILABLE",
        message: "AI ordering is paused because live product and stock data is unavailable.",
      });
    }

    const aiResult = await openaiService.generateAIReply({
      customerPhone: customerPhone || "guest_user",
      message,
      productsCatalog,
    });

    res.json({
      success: true,
      reply: aiResult.reply,
      session: aiResult.session,
    });
  } catch (error) {
    console.error("AI Reply error:", error.message);
    res.status(500).json({
      success: false,
      message: "An error occurred while generating AI reply",
    });
  }
};

module.exports = {
  handleAIReply,
};
