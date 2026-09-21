const fs = require("fs");
const path = require("path");
const mongo = require("./mongo");
const Customer = require("../models/Customer");
const Message = require("../models/Message");

const DATA_DIR = path.join(__dirname, "../../data");
const CONVERSATIONS_FILE = path.join(DATA_DIR, "conversations.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");

// ---------------------------------------------------------------------------
// Low-level atomic JSON read / write (for local development fallback)
// ---------------------------------------------------------------------------

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

const readJSON = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (error) {
    console.error(`storageService: Failed to read ${filePath}:`, error.message);
    return [];
  }
};

const writeJSON = (filePath, data) => {
  ensureDataDir();
  const tempPath = filePath + ".tmp";
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tempPath, filePath);
};

// ---------------------------------------------------------------------------
// Robust Phone Normalization — canonical E.164 format (e.g. 919876543210)
// Strips spaces, dashes, +, parentheses, and handles 10-digit / leading 0 numbers
// ---------------------------------------------------------------------------

const normalizePhone = (phone) => {
  if (!phone) return "";
  let cleaned = String(phone).replace(/[\s\-\+\(\)]/g, "");

  // If 11 digits starting with 0 (e.g. 09876543210), replace leading 0 with 91
  if (/^0[6-9]\d{9}$/.test(cleaned)) {
    cleaned = `91${cleaned.slice(1)}`;
  }
  // If standard 10-digit Indian mobile number (e.g. 9876543210), prefix with 91
  else if (/^[6-9]\d{9}$/.test(cleaned)) {
    cleaned = `91${cleaned}`;
  }

  return cleaned;
};

const generateMessageId = (phone) => {
  return `msg_${Date.now()}_${normalizePhone(phone)}_${Math.random().toString(36).slice(2, 8)}`;
};

// ---------------------------------------------------------------------------
// Helper: Check if MongoDB mode is currently active
// ---------------------------------------------------------------------------

const isMongoActive = () => {
  return Boolean(mongo.isConnected() && Customer && Message);
};

// ---------------------------------------------------------------------------
// Customer Name Lookup
// ---------------------------------------------------------------------------

const getCustomerName = async (phone) => {
  const normalized = normalizePhone(phone);
  if (!normalized) return "";

  if (isMongoActive()) {
    try {
      const customer = await Customer.findOne({ phone: normalized }).lean();
      return customer?.name || "";
    } catch (err) {
      console.warn("MongoDB getCustomerName error:", err.message);
    }
  }

  // Local JSON fallback
  const conversations = readJSON(CONVERSATIONS_FILE);
  const found = conversations.find((c) => normalizePhone(c.phone) === normalized);
  return found?.name || "";
};

// ---------------------------------------------------------------------------
// Upsert Conversation / Customer Profile (Customer 360)
// NEVER overwrites customerSince when a returning customer messages again!
// ---------------------------------------------------------------------------

const upsertConversation = async (phone, name, lastMessage) => {
  const normalized = normalizePhone(phone);
  const now = new Date();
  const nowIso = now.toISOString();

  if (isMongoActive()) {
    try {
      const updateDoc = {
        $set: {
          lastActive: now,
          lastMessage: lastMessage || "",
        },
        $inc: {
          unreadCount: 1,
          totalMessages: 1,
        },
        $setOnInsert: {
          phone: normalized,
          customerSince: now,
        },
      };

      if (name && name !== normalized) {
        updateDoc.$set.name = name;
      }

      const updated = await Customer.findOneAndUpdate(
        { phone: normalized },
        updateDoc,
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();

      return {
        phone: updated.phone,
        name: updated.name || updated.phone,
        lastMessage: updated.lastMessage || "",
        lastUpdated: updated.lastActive ? new Date(updated.lastActive).toISOString() : nowIso,
        unreadCount: updated.unreadCount || 0,
        customerSince: updated.customerSince ? new Date(updated.customerSince).toISOString() : nowIso,
        totalMessages: updated.totalMessages || 1,
      };
    } catch (err) {
      console.warn("MongoDB upsertConversation error, using local fallback:", err.message);
    }
  }

  // Local JSON fallback
  const conversations = readJSON(CONVERSATIONS_FILE);
  const existing = conversations.find(
    (c) => normalizePhone(c.phone) === normalized,
  );

  if (existing) {
    // Returning customer: update activity, PRESERVE original customerSince
    if (name && name !== normalized) {
      existing.name = name;
    }
    existing.lastMessage = lastMessage || existing.lastMessage;
    existing.lastUpdated = nowIso;
    existing.unreadCount = (existing.unreadCount || 0) + 1;
    existing.totalMessages = (existing.totalMessages || 0) + 1;
  } else {
    // Brand new customer
    conversations.push({
      phone: normalized,
      name: name || normalized,
      lastMessage: lastMessage || "",
      lastUpdated: nowIso,
      unreadCount: 1,
      customerSince: nowIso,
      totalMessages: 1,
    });
  }

  writeJSON(CONVERSATIONS_FILE, conversations);
  return existing || conversations[conversations.length - 1];
};

// ---------------------------------------------------------------------------
// Update Customer Delivery Details (Address, Slot, Payment Method)
// ---------------------------------------------------------------------------

const updateCustomerDeliveryDetails = async (phone, { name, address, slot, paymentMethod }) => {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const updateFields = {};
  if (name && name !== "there" && name !== "Customer") updateFields.name = name;
  if (address && !address.includes("Please provide") && address !== "To be confirmed") updateFields.address = address;
  if (slot) updateFields.deliverySlot = slot;
  if (paymentMethod) updateFields.paymentMethod = paymentMethod;

  if (Object.keys(updateFields).length === 0) return null;

  if (isMongoActive()) {
    try {
      await Customer.findOneAndUpdate(
        { phone: normalized },
        { $set: updateFields },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      return;
    } catch (err) {
      console.warn("MongoDB updateCustomerDeliveryDetails error:", err.message);
    }
  }

  // Local JSON fallback
  const conversations = readJSON(CONVERSATIONS_FILE);
  const found = conversations.find((c) => normalizePhone(c.phone) === normalized);
  if (found) {
    Object.assign(found, updateFields);
    writeJSON(CONVERSATIONS_FILE, conversations);
  }
};

// ---------------------------------------------------------------------------
// Save Customer Order (Order history, totals, address mapping to Customer)
// ---------------------------------------------------------------------------

const saveCustomerOrder = async (phone, orderData) => {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const now = new Date();
  const orderRecord = {
    orderId: String(orderData.orderId || ""),
    orderNumber: String(orderData.orderNumber || ""),
    total: Number(orderData.total || 0),
    items: Array.isArray(orderData.items)
      ? orderData.items.map((i) => ({
          id: Number(i.id),
          name: String(i.name || ""),
          price: Number(i.price || 0),
          quantity: Number(i.quantity || 1),
        }))
      : [],
    deliveryAddress: String(orderData.address || orderData.deliveryAddress || ""),
    deliverySlot: String(orderData.deliverySlot || orderData.slot || ""),
    paymentMethod: String(orderData.paymentMethod || ""),
    paymentUrl: String(orderData.paymentUrl || ""),
    status: orderData.status || "confirmed",
    createdAt: now,
  };

  const updateSet = {
    lastOrderDate: now,
    lastActive: now,
  };
  if (orderData.customerName && orderData.customerName !== "there" && orderData.customerName !== "Customer") {
    updateSet.name = orderData.customerName;
  }
  if (orderRecord.deliveryAddress && !orderRecord.deliveryAddress.includes("Please provide")) {
    updateSet.address = orderRecord.deliveryAddress;
  }
  if (orderRecord.deliverySlot) {
    updateSet.deliverySlot = orderRecord.deliverySlot;
  }
  if (orderRecord.paymentMethod) {
    updateSet.paymentMethod = orderRecord.paymentMethod;
  }

  if (isMongoActive()) {
    try {
      await Customer.findOneAndUpdate(
        { phone: normalized },
        {
          $set: updateSet,
          $push: { orders: orderRecord },
          $inc: {
            orderCount: 1,
            totalSpent: orderRecord.total,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      console.log(`[DB] Saved order ${orderRecord.orderNumber} for customer ${normalized} in MongoDB Atlas.`);
      return orderRecord;
    } catch (err) {
      console.warn("MongoDB saveCustomerOrder error:", err.message);
    }
  }

  // Local JSON fallback
  const conversations = readJSON(CONVERSATIONS_FILE);
  let found = conversations.find((c) => normalizePhone(c.phone) === normalized);
  if (!found) {
    found = {
      phone: normalized,
      name: updateSet.name || normalized,
      unreadCount: 0,
      customerSince: now.toISOString(),
      totalMessages: 1,
    };
    conversations.push(found);
  }

  Object.assign(found, updateSet);
  if (!Array.isArray(found.orders)) found.orders = [];
  found.orders.push({ ...orderRecord, createdAt: now.toISOString() });
  found.orderCount = (found.orderCount || 0) + 1;
  found.totalSpent = (found.totalSpent || 0) + orderRecord.total;
  found.lastOrderDate = now.toISOString();

  writeJSON(CONVERSATIONS_FILE, conversations);
  return orderRecord;
};

// ---------------------------------------------------------------------------
// Save Incoming Customer Message
// ---------------------------------------------------------------------------

const saveIncomingMessage = async (phone, name, text, messageId = null) => {
  const normalized = normalizePhone(phone);
  const now = new Date();
  const nowIso = now.toISOString();
  const customerName = name || (await getCustomerName(normalized)) || normalized;
  const id = messageId || generateMessageId(normalized);

  if (isMongoActive()) {
    try {
      // 1. Upsert Customer Profile
      const updateDoc = {
        $set: {
          lastActive: now,
          lastMessage: text || "",
        },
        $inc: {
          unreadCount: 1,
          totalMessages: 1,
        },
        $setOnInsert: {
          phone: normalized,
          customerSince: now,
        },
      };
      if (customerName && customerName !== normalized) {
        updateDoc.$set.name = customerName;
      }

      await Customer.findOneAndUpdate({ phone: normalized }, updateDoc, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      });

      // 2. Insert Message into Messages Collection
      const messageDoc = await Message.create({
        id,
        phone: normalized,
        customerName,
        sender: "customer",
        isAI: false,
        text: text || "",
        timestamp: now,
        status: "received",
      });

      console.log(
        `[WHATSAPP LOG - INCOMING (MongoDB)] Name: "${customerName}" | Mobile: "${normalized}" | Message: "${text}"`,
      );

      return {
        id: messageDoc.id,
        phone: messageDoc.phone,
        customerName: messageDoc.customerName,
        sender: messageDoc.sender,
        isAI: false,
        text: messageDoc.text,
        timestamp: messageDoc.timestamp.toISOString(),
        status: messageDoc.status,
      };
    } catch (err) {
      console.warn("MongoDB saveIncomingMessage error, using local fallback:", err.message);
    }
  }

  // Local JSON fallback
  const message = {
    id,
    phone: normalized,
    customerName,
    sender: "customer",
    isAI: false,
    text: text || "",
    timestamp: nowIso,
    status: "received",
  };

  const messages = readJSON(MESSAGES_FILE);
  messages.push(message);
  writeJSON(MESSAGES_FILE, messages);

  // Upsert the conversation entry
  await upsertConversation(normalized, customerName, text);

  console.log(
    `[WHATSAPP LOG - INCOMING (Local)] Name: "${customerName}" | Mobile: "${normalized}" | Message: "${text}"`,
  );

  return message;
};

// ---------------------------------------------------------------------------
// Save Outgoing Agent / AI Message
// ---------------------------------------------------------------------------

const saveOutgoingMessage = async (phone, text, isAI = false, name = "") => {
  const normalized = normalizePhone(phone);
  const now = new Date();
  const nowIso = now.toISOString();
  const customerName = name || (await getCustomerName(normalized)) || normalized;
  const id = generateMessageId(normalized);

  if (isMongoActive()) {
    try {
      // 1. Update Customer Profile
      const updateDoc = {
        $set: {
          lastActive: now,
          lastMessage: text || "",
        },
        $inc: {
          totalMessages: 1,
        },
        $setOnInsert: {
          phone: normalized,
          customerSince: now,
          unreadCount: 0,
        },
      };
      if (customerName && customerName !== normalized) {
        updateDoc.$set.name = customerName;
      }

      await Customer.findOneAndUpdate({ phone: normalized }, updateDoc, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      });

      // 2. Insert Message into Messages Collection
      const messageDoc = await Message.create({
        id,
        phone: normalized,
        customerName,
        sender: "agent",
        isAI,
        text: text || "",
        timestamp: now,
        status: "sent",
      });

      console.log(
        `[WHATSAPP LOG - OUTGOING ${isAI ? "AI" : "MANUAL"} (MongoDB)] To: "${customerName}" (${normalized}) | Message: "${text}"`,
      );

      return {
        id: messageDoc.id,
        phone: messageDoc.phone,
        customerName: messageDoc.customerName,
        sender: messageDoc.sender,
        isAI,
        text: messageDoc.text,
        timestamp: messageDoc.timestamp.toISOString(),
        status: messageDoc.status,
      };
    } catch (err) {
      console.warn("MongoDB saveOutgoingMessage error, using local fallback:", err.message);
    }
  }

  // Local JSON fallback
  const message = {
    id,
    phone: normalized,
    customerName,
    sender: "agent",
    isAI,
    text: text || "",
    timestamp: nowIso,
    status: "sent",
  };

  const messages = readJSON(MESSAGES_FILE);
  messages.push(message);
  writeJSON(MESSAGES_FILE, messages);

  // Update conversation last message
  const conversations = readJSON(CONVERSATIONS_FILE);
  const existing = conversations.find(
    (c) => normalizePhone(c.phone) === normalized,
  );
  if (existing) {
    existing.lastMessage = text;
    existing.lastUpdated = nowIso;
    existing.totalMessages = (existing.totalMessages || 0) + 1;
    if (customerName && customerName !== normalized) {
      existing.name = customerName;
    }
  } else {
    conversations.push({
      phone: normalized,
      name: customerName || normalized,
      lastMessage: text || "",
      lastUpdated: nowIso,
      unreadCount: 0,
      customerSince: nowIso,
      totalMessages: 1,
    });
  }
  writeJSON(CONVERSATIONS_FILE, conversations);

  console.log(
    `[WHATSAPP LOG - OUTGOING ${isAI ? "AI" : "MANUAL"} (Local)] To: "${customerName}" (${normalized}) | Message: "${text}"`,
  );

  return message;
};

// ---------------------------------------------------------------------------
// Mark Conversation as Read
// ---------------------------------------------------------------------------

const markConversationRead = async (phone) => {
  const normalized = normalizePhone(phone);
  if (!normalized) return;

  if (isMongoActive()) {
    try {
      await Customer.updateOne(
        { phone: normalized },
        { $set: { unreadCount: 0 } },
      );
      return;
    } catch (err) {
      console.warn("MongoDB markConversationRead error:", err.message);
    }
  }

  // Local JSON fallback
  const conversations = readJSON(CONVERSATIONS_FILE);
  const conversation = conversations.find(
    (c) => normalizePhone(c.phone) === normalized,
  );
  if (conversation) {
    conversation.unreadCount = 0;
    writeJSON(CONVERSATIONS_FILE, conversations);
  }
};

// ---------------------------------------------------------------------------
// Get All Conversations List
// ---------------------------------------------------------------------------

const getConversations = async () => {
  if (isMongoActive()) {
    try {
      const customers = await Customer.find().sort({ lastActive: -1 }).lean();
      return customers.map((c) => ({
        phone: c.phone,
        name: c.name || c.phone,
        lastMessage: c.lastMessage || "",
        lastUpdated: c.lastActive ? new Date(c.lastActive).toISOString() : new Date().toISOString(),
        unreadCount: c.unreadCount || 0,
        customerSince: c.customerSince ? new Date(c.customerSince).toISOString() : new Date().toISOString(),
        totalMessages: c.totalMessages || 0,
      }));
    } catch (err) {
      console.warn("MongoDB getConversations error, using local fallback:", err.message);
    }
  }

  // Local JSON fallback
  const conversations = readJSON(CONVERSATIONS_FILE);
  return conversations.sort(
    (a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated),
  );
};

// ---------------------------------------------------------------------------
// Get Messages Thread by Phone
// ---------------------------------------------------------------------------

const getMessagesByPhone = async (phone) => {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];

  if (isMongoActive()) {
    try {
      const msgs = await Message.find({ phone: normalized })
        .sort({ timestamp: 1 })
        .lean();
      const customer = await Customer.findOne({ phone: normalized }).lean();
      const fallbackName = customer?.name || normalized;

      return msgs.map((m) => ({
        id: m.id,
        phone: normalized,
        customerName: m.customerName || fallbackName,
        sender: m.sender,
        isAI: Boolean(m.isAI),
        text: m.text,
        timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
        status: m.status,
      }));
    } catch (err) {
      console.warn("MongoDB getMessagesByPhone error, using local fallback:", err.message);
    }
  }

  // Local JSON fallback
  const messages = readJSON(MESSAGES_FILE);
  const conversations = readJSON(CONVERSATIONS_FILE);
  const conversation = conversations.find(
    (c) => normalizePhone(c.phone) === normalized,
  );
  const fallbackName = conversation?.name || normalized;

  return messages
    .filter((m) => normalizePhone(m.phone) === normalized)
    .map((m) => ({
      ...m,
      phone: normalized,
      customerName: m.customerName || fallbackName,
    }))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
};

// ---------------------------------------------------------------------------
// Get All Message Logs
// ---------------------------------------------------------------------------

const getAllMessageLogs = async () => {
  if (isMongoActive()) {
    try {
      const msgs = await Message.find().sort({ timestamp: 1 }).lean();
      return msgs.map((m) => ({
        id: m.id,
        name: m.customerName || m.phone,
        phone: m.phone,
        sender: m.sender,
        isAI: Boolean(m.isAI),
        text: m.text,
        timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
        status: m.status,
      }));
    } catch (err) {
      console.warn("MongoDB getAllMessageLogs error, using local fallback:", err.message);
    }
  }

  // Local JSON fallback
  const messages = readJSON(MESSAGES_FILE);
  const conversations = readJSON(CONVERSATIONS_FILE);
  const nameMap = new Map();
  conversations.forEach((c) => {
    nameMap.set(normalizePhone(c.phone), c.name);
  });

  return messages
    .map((m) => {
      const normalized = normalizePhone(m.phone);
      const name = m.customerName || nameMap.get(normalized) || normalized;
      return {
        id: m.id,
        name,
        phone: normalized,
        sender: m.sender,
        isAI: !!m.isAI,
        text: m.text,
        timestamp: m.timestamp,
        status: m.status,
      };
    })
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
};

// ---------------------------------------------------------------------------
// Customer stats (for /api/customers endpoint)
// ---------------------------------------------------------------------------

const getCustomerStats = async () => {
  if (isMongoActive()) {
    try {
      const customers = await Customer.find().sort({ lastActive: -1 }).lean();
      return customers.map((c) => ({
        name: c.name || c.phone,
        phone: c.phone,
        address: c.address || "",
        deliverySlot: c.deliverySlot || "",
        paymentMethod: c.paymentMethod || "",
        orderCount: c.orderCount || (Array.isArray(c.orders) ? c.orders.length : 0),
        totalSpent: c.totalSpent || 0,
        orders: c.orders || [],
        lastOrderDate: c.lastOrderDate ? new Date(c.lastOrderDate).toISOString() : null,
        totalMessages: c.totalMessages || 0,
        lastActive: c.lastActive ? new Date(c.lastActive).toISOString() : new Date().toISOString(),
        customerSince: c.customerSince ? new Date(c.customerSince).toISOString() : new Date().toISOString(),
      }));
    } catch (err) {
      console.warn("MongoDB getCustomerStats error, using local fallback:", err.message);
    }
  }

  // Local JSON fallback
  const conversations = readJSON(CONVERSATIONS_FILE);
  return conversations
    .map((c) => ({
      name: c.name,
      phone: c.phone,
      address: c.address || "",
      deliverySlot: c.deliverySlot || "",
      paymentMethod: c.paymentMethod || "",
      orderCount: c.orderCount || (Array.isArray(c.orders) ? c.orders.length : 0),
      totalSpent: c.totalSpent || 0,
      orders: c.orders || [],
      lastOrderDate: c.lastOrderDate || null,
      totalMessages: c.totalMessages || 0,
      lastActive: c.lastUpdated,
      customerSince: c.customerSince,
    }))
    .sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));
};

// ---------------------------------------------------------------------------
// Dashboard aggregate stats
// ---------------------------------------------------------------------------

const getStats = async () => {
  if (isMongoActive()) {
    try {
      const totalCustomers = await Customer.countDocuments();
      const totalMessages = await Message.countDocuments();
      const aiMessages = await Message.countDocuments({ isAI: true });
      const customerMessages = await Message.countDocuments({ sender: "customer" });
      const unreadResult = await Customer.aggregate([
        { $group: { _id: null, totalUnread: { $sum: "$unreadCount" } } },
      ]);
      const unreadTotal = unreadResult[0]?.totalUnread || 0;

      return {
        totalCustomers,
        totalMessages,
        aiMessages,
        customerMessages,
        unreadTotal,
        aiHandledPercent:
          customerMessages > 0
            ? Math.round((aiMessages / customerMessages) * 100)
            : 0,
      };
    } catch (err) {
      console.warn("MongoDB getStats error, using local fallback:", err.message);
    }
  }

  // Local JSON fallback
  const conversations = readJSON(CONVERSATIONS_FILE);
  const messages = readJSON(MESSAGES_FILE);

  const totalCustomers = conversations.length;
  const totalMessages = messages.length;
  const aiMessages = messages.filter((m) => m.isAI).length;
  const customerMessages = messages.filter(
    (m) => m.sender === "customer",
  ).length;
  const unreadTotal = conversations.reduce(
    (sum, c) => sum + (c.unreadCount || 0),
    0,
  );

  return {
    totalCustomers,
    totalMessages,
    aiMessages,
    customerMessages,
    unreadTotal,
    aiHandledPercent:
      customerMessages > 0
        ? Math.round((aiMessages / customerMessages) * 100)
        : 0,
  };
};

// ---------------------------------------------------------------------------
// Sync local JSON chats to MongoDB Atlas (preserves history across restarts)
// ---------------------------------------------------------------------------

const syncLocalToMongo = async () => {
  // Permanently disabled: Local data must never be synced into production MongoDB Atlas
  return;
};

module.exports = {
  upsertConversation,
  updateCustomerDeliveryDetails,
  saveCustomerOrder,
  saveIncomingMessage,
  saveOutgoingMessage,
  getConversations,
  getMessagesByPhone,
  getAllMessageLogs,
  getCustomerName,
  getCustomerStats,
  getStats,
  markConversationRead,
  normalizePhone,
  isMongoActive,
  syncLocalToMongo,
};
