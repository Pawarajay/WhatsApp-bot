const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "../../data");
const CHATS_FILE = path.join(DATA_DIR, "chats.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure chats.json file exists with initial structure
if (!fs.existsSync(CHATS_FILE)) {
  const initialData = {
    conversations: [
      {
        phone: "+91 8459628112",
        name: "Rahul Mehta",
        lastMessage: "Yes, please add two croissants as well.",
        updatedAt: new Date().toISOString()
      },
      {
        phone: "+91 9820155432",
        name: "Aisha Kapoor",
        lastMessage: "Thank you! The order arrived fresh.",
        updatedAt: new Date(Date.now() - 3600000).toISOString()
      },
      {
        phone: "+91 9811122334",
        name: "Vikram Shah",
        lastMessage: "Can I schedule delivery for tomorrow?",
        updatedAt: new Date(Date.now() - 86400000).toISOString()
      }
    ],
    messages: [
      {
        id: "msg_1",
        phone: "+91 8459628112",
        sender: "customer",
        text: "Hi! I want to place my usual order.",
        isAI: false,
        timestamp: "10:30 AM"
      },
      {
        id: "msg_2",
        phone: "+91 8459628112",
        sender: "agent",
        text: "Hi Rahul 👋 Your favourite sourdough is fresh today! Would you like to place your usual order?",
        isAI: true,
        timestamp: "10:31 AM"
      },
      {
        id: "msg_3",
        phone: "+91 8459628112",
        sender: "customer",
        text: "Yes, please add two croissants as well.",
        isAI: false,
        timestamp: "10:42 AM"
      },
      {
        id: "msg_4",
        phone: "+91 9820155432",
        sender: "customer",
        text: "Thank you! The order arrived fresh.",
        isAI: false,
        timestamp: "9:18 AM"
      },
      {
        id: "msg_5",
        phone: "+91 9811122334",
        sender: "customer",
        text: "Can I schedule delivery for tomorrow?",
        isAI: false,
        timestamp: "Yesterday"
      }
    ]
  };
  fs.writeFileSync(CHATS_FILE, JSON.stringify(initialData, null, 2), "utf8");
}

const readData = () => {
  try {
    const raw = fs.readFileSync(CHATS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Error reading chats file:", err.message);
    return { conversations: [], messages: [] };
  }
};

const writeData = (data) => {
  try {
    fs.writeFileSync(CHATS_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Error writing chats file:", err.message);
  }
};

const formatTime = () => {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const normalizePhone = (phone) => {
  if (!phone) return "";
  return phone.toString().trim();
};

/**
 * Save incoming or outgoing message
 * @param {Object} param0
 * @param {string} param0.phone
 * @param {string} [param0.name]
 * @param {'customer'|'agent'} param0.sender
 * @param {string} param0.text
 * @param {boolean} [param0.isAI]
 */
const saveMessage = async ({ phone, name, sender, text, isAI = false }) => {
  const normPhone = normalizePhone(phone);
  const data = readData();
  const timestamp = formatTime();
  const nowIso = new Date().toISOString();

  const newMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    phone: normPhone,
    sender,
    text,
    isAI: Boolean(isAI),
    timestamp
  };

  data.messages.push(newMessage);

  // Update or insert conversation
  const existingIndex = data.conversations.findIndex((c) => c.phone === normPhone);
  if (existingIndex !== -1) {
    data.conversations[existingIndex].lastMessage = text;
    data.conversations[existingIndex].updatedAt = nowIso;
    if (name && (!data.conversations[existingIndex].name || data.conversations[existingIndex].name === normPhone)) {
      data.conversations[existingIndex].name = name;
    }
  } else {
    data.conversations.push({
      phone: normPhone,
      name: name || normPhone,
      lastMessage: text,
      updatedAt: nowIso
    });
  }

  writeData(data);
  return newMessage;
};

/**
 * Get all conversations sorted by latest updated
 */
const getConversations = async () => {
  const data = readData();
  return [...data.conversations].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
};

/**
 * Get all messages for a specific phone number
 */
const getMessagesByPhone = async (phone) => {
  const normPhone = normalizePhone(phone);
  const data = readData();
  return data.messages.filter((m) => m.phone === normPhone);
};

module.exports = {
  saveMessage,
  getConversations,
  getMessagesByPhone
};
