const dns = require("dns");

// Configure DNS for optimal SRV and IPv4 resolution before loading database drivers
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder("ipv4first");
  }
} catch (e) {
  // Ignore if not permitted
}

let mongoose;
try {
  mongoose = require("mongoose");
} catch (e) {
  mongoose = null;
}

const env = require("../config/env");

let isMongoConnected = false;

// Construct MongoDB URI dynamically from configuration
const getUriForConfig = (config) => {
  const { host, port, user, password, name } = config || {};
  if (!host) return "";

  // MongoDB Atlas Cluster (host contains mongodb.net)
  if (host.includes("mongodb.net")) {
    const auth =
      user && password
        ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`
        : "";
    return `mongodb+srv://${auth}${host}/${name || "bombaysourdough"}?retryWrites=true&w=majority&appName=VarunCluster`;
  }

  // Local or custom standalone MongoDB server (e.g. localhost:27017)
  if (user && password) {
    return `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port || 27017}/${name || "bombaysourdough"}`;
  }

  return `mongodb://${host}:${port || 27017}/${name || "bombaysourdough"}`;
};

const buildMongoUri = (targetConfig) => {
  if (env.mongodb?.uri) {
    return env.mongodb.uri;
  }
  return getUriForConfig(targetConfig || env.prodDb || env.db);
};

const connectDB = async () => {
  if (!mongoose) {
    console.log(
      "[DB] Mongoose package is not loaded. Operating with local persistent storage engine.",
    );
    isMongoConnected = false;
    return false;
  }

  // 1. If explicit MONGODB_URI is provided
  if (env.mongodb?.uri) {
    try {
      const conn = await mongoose.connect(env.mongodb.uri, {
        autoIndex: true,
        serverSelectionTimeoutMS: 10000,
      });
      isMongoConnected = true;
      console.log(`[DB] MongoDB Connected via MONGODB_URI: ${conn.connection.host}/${conn.connection.name}`);
      return true;
    } catch (err) {
      console.warn(`[DB] Connection via MONGODB_URI failed: ${err.message}`);
    }
  }

  // 2. Check if deployed on cloud (Render / Vercel / Production)
  const isCloudOrProd = Boolean(
    process.env.RENDER ||
    process.env.VERCEL ||
    process.env.NODE_ENV === "production"
  );

  const targets = [];
  if (isCloudOrProd) {
    // In production or on cloud (Render/Vercel), prioritize MongoDB Atlas Cloud Cluster
    if (env.prodDb?.host) targets.push({ name: "MongoDB Atlas (Cloud)", config: env.prodDb });
    if (env.db?.host && env.db.host !== "localhost") targets.push({ name: "Primary DB", config: env.db });
  } else {
    // In local dev, try local first if specified, but fallback to Atlas if localhost is down
    if (env.db?.host) targets.push({ name: "Local DB", config: env.db });
    if (env.prodDb?.host) targets.push({ name: "MongoDB Atlas (Cloud Fallback)", config: env.prodDb });
  }

  for (const target of targets) {
    const targetUri = getUriForConfig(target.config);
    if (!targetUri) continue;
    try {
      console.log(`[DB] Attempting connection to ${target.name}...`);
      const conn = await mongoose.connect(targetUri, {
        autoIndex: true,
        serverSelectionTimeoutMS: 8000,
      });
      isMongoConnected = true;
      console.log(
        `[DB] MongoDB Connected successfully to ${target.name}: ${conn.connection.host}/${conn.connection.name}`,
      );
      return true;
    } catch (error) {
      console.warn(`[DB] Connection to ${target.name} failed: ${error.message}`);
    }
  }

  isMongoConnected = false;
  console.warn(
    `[DB] Operating with local fallback storage engine. Warning: Ephemeral cloud containers will not retain local JSON files after spin-down.`,
  );
  return false;
};

const isConnected = () =>
  Boolean(isMongoConnected && mongoose && mongoose.connection.readyState === 1);

const disconnectDB = async () => {
  if (isMongoConnected && mongoose) {
    await mongoose.disconnect();
    isMongoConnected = false;
  }
};

module.exports = {
  buildMongoUri,
  connectDB,
  isConnected,
  disconnectDB,
};
