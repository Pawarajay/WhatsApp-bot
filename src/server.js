const dns = require("dns");
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder("ipv4first");
  }
} catch (e) {}

const express = require("express");
const cors = require("cors");
const env = require("./config/env");
const mongo = require("./db/mongo");

const productRoutes = require("./routes/productRoutes");
const orderRoutes = require("./routes/orderRoutes");
const whatsappRoutes = require("./routes/whatsappRoutes");
const aiRoutes = require("./routes/aiRoutes");
const customerRoutes = require("./routes/customerRoutes");

const app = express();

const allowedOrigins = env.allowedOrigins
  ? env.allowedOrigins.split(",").map((o) => o.trim())
  : ["http://localhost:5173"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "WhatsApp AI Agent Backend API Running",
  });
});

app.get("/api/health", (req, res) => {
  const isAocConfigured = Boolean(env.aoc?.apiKey && env.aoc?.apiUrl);
  const isWhatsappConfigured = Boolean(isAocConfigured || (env.whatsapp?.accessToken && env.whatsapp?.phoneNumberId));
  const isMongoActive = mongo.isConnected();
  res.json({
    success: true,
    message: "Backend service is healthy",
    environment: process.env.NODE_ENV || "development",
    storageMode: isMongoActive ? "mongodb_atlas" : "local_persistent_storage",
    mongoConnected: isMongoActive,
    whatsappConnected: isWhatsappConfigured,
    provider: isAocConfigured ? "aoc" : env.whatsapp?.accessToken ? "meta" : "none",
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/customers", customerRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err);
  res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
});

const PORT = env.port;

mongo
  .connectDB()
  .then((connected) => {
    if (connected) {
      console.log("[DB] MongoDB Atlas connected. Local sync disabled to protect production data.");
    }
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });