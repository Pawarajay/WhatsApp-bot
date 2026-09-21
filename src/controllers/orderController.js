const woocommerceService = require("../services/woocommerceService");
const createdOrders = new Map();

const getOrders = async (req, res) => {
  try {
    const [result, counts] = await Promise.all([
      woocommerceService.getOrdersPage(req.query),
      woocommerceService.getOrderCounts(),
    ]);
    res.json({
      success: true,
      data: result.orders,
      count: result.total,
      totalPages: result.totalPages,
      page: result.page,
      perPage: result.perPage,
      counts,
      source: "woocommerce",
    });
  } catch (error) {
    console.error("Order list unavailable:", error.response?.data || error.message);
    res.status(503).json({
      success: false,
      code: "ORDER_BACKEND_UNAVAILABLE",
      message: "Order data is unavailable. No sample orders were returned.",
    });
  }
};

const getOrderById = async (req, res) => {
  try {
    const order = await woocommerceService.getOrderById(req.params.id);
    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: "Order not found",
    });
  }
};

const createOrder = async (req, res) => {
  try {
    const { line_items, billing, shipping, delivery } = req.body;
    
    // Basic validation
    if (!line_items || !Array.isArray(line_items) || line_items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Order must contain at least one line item with valid product ID and quantity",
      });
    }

    if (!billing || !billing.first_name || !billing.phone) {
      return res.status(400).json({
        success: false,
        message: "Order must contain customer details (first_name, phone)",
      });
    }
    const requestKey = req.get("Idempotency-Key") || req.body.idempotency_key;
    if (requestKey && createdOrders.has(requestKey)) {
      return res.status(200).json({ success: true, data: createdOrders.get(requestKey), duplicate: true });
    }

    try {
      const stockChecks = await Promise.all(line_items.map(async (item) => {
        if (!item.product_id || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1) {
          throw new Error("Each line item must include a valid product_id and positive integer quantity.");
        }
        const product = await woocommerceService.getProductById(item.product_id);
        const available = product.stock_quantity == null ? product.stock_status !== "outofstock" : Number(product.stock_quantity);
        if (available === false || (typeof available === "number" && available < Number(item.quantity))) {
          throw new Error(`Insufficient stock for product ${item.product_id}.`);
        }
        return true;
      }));
      if (stockChecks.length !== line_items.length) throw new Error("Unable to validate order stock.");
      const createdOrder = await woocommerceService.createOrder(req.body);
      if (requestKey) createdOrders.set(requestKey, createdOrder);
      return res.status(201).json({
        success: true,
        data: createdOrder,
        source: "woocommerce",
      });
    } catch (wcErr) {
      console.error("Order creation failed:", wcErr.response?.data || wcErr.message);
      return res.status(503).json({
        success: false,
        code: "ORDER_BACKEND_UNAVAILABLE",
        message: "The order backend is unavailable. No order was created.",
      });
    }
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create order",
    });
  }
};

const createPaymentLink = async (req, res) => {
  const { orderId, amount, phone } = req.body;
  if (!orderId || !amount || !phone) {
    return res.status(400).json({ success: false, message: "orderId, amount and phone are required" });
  }
  const { baseUrl, apiKey, provider } = require("../config/env").payments;
  if (!provider || !baseUrl || !apiKey) {
    return res.status(200).json({
      success: true,
      pending: true,
      code: "PAYMENT_NOT_CONFIGURED",
      message: "Payment gateway is not configured. The order remains payment-pending; set PAYMENT_PROVIDER, PAYMENT_API_BASE_URL, and PAYMENT_API_KEY in backend/.env.",
      data: { orderId, amount, phone, paymentStatus: "pending" },
    });
  }
  return res.status(501).json({
    success: false,
    code: "PAYMENT_PROVIDER_ADAPTER_REQUIRED",
    message: `Payment provider ${provider} is configured, but its documented create-link adapter is not implemented.`,
  });
};

module.exports = {
  getOrders,
  getOrderById,
  createOrder,
  createPaymentLink,
};
