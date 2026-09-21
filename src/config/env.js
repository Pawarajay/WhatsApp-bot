require("dotenv").config();

module.exports = {
  port: process.env.PORT || 5000,
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  woocommerce: {
    url: process.env.WOOCOMMERCE_URL || "https://bombaysourdoughcompany.com",
    consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY || "",
    consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET || "",
  },
  aoc: {
    apiUrl: process.env.WHATSAPP_API_URL || "",
    apiKey: process.env.WHATSAPP_API_KEY || "",
    from: process.env.WHATSAPP_FROM || "",
    campaignName: process.env.WHATSAPP_CAMPAIGN_NAME || "",
  },
  whatsapp: {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  },
  crm: {
    apiKey: process.env.CRM_API_KEY || "",
    baseUrl: process.env.CRM_API_BASE_URL || "",
    sendPath: process.env.CRM_SEND_MESSAGE_PATH || "",
    webhookSecret: process.env.CRM_WEBHOOK_SECRET || "",
  },
  payments: {
    provider: process.env.PAYMENT_PROVIDER || "",
    baseUrl: process.env.PAYMENT_API_BASE_URL || "",
    apiKey: process.env.PAYMENT_API_KEY || "",
  },
  // openai: {
  //   apiKey: process.env.OPENAI_API_KEY || "",
  // },


  gemini: {
  apiKey: process.env.GEMINI_API_KEY || "",
  model: process.env.GEMINI_MODEL || "", // optional override, defaults to gemini-2.5-flash in code
},
  allowedOrigins: process.env.ALLOWED_ORIGINS || "http://localhost:5173",
  isProduction: process.env.NODE_ENV === "production",
  // Local Database Settings (Default for local development)
  db: {
    type: process.env.DB_TYPE || "mongodb",
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "27017", 10),
    user: process.env.DB_USER || "",
    password: process.env.DB_PASSWORD || "",
    name: process.env.DB_NAME || "bombaysourdough",
  },
  // Production Database Settings (Used in production or when NODE_ENV=production)
  prodDb: {
    type: process.env.PROD_DB_TYPE || "mongodb",
    host: process.env.PROD_DB_HOST || "varuncluster.p1q0idr.mongodb.net",
    port: parseInt(process.env.PROD_DB_PORT || "27017", 10),
    user: process.env.PROD_DB_USER || "Varundb",
    password: process.env.PROD_DB_PASSWORD || "varun",
    name: process.env.PROD_DB_NAME || "bombaysourdough",
  },
  mongodb: {
    uri: process.env.MONGODB_URI || "",
  },
};
