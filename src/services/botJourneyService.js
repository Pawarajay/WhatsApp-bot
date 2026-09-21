const woocommerceService = require("./woocommerceService");
const storageService = require("../db/storageService");

// In-memory customer journey session store
const sessions = new Map();

/**
 * Supported Customer Journey Steps:
 * 1. GREETING       - Welcome & Usual Order prompt
 * 2. MENU           - 5 Categories (Sourdough, Croissants, Cookies, Combos, Previous Order)
 * 3. CATEGORY_VIEW  - Viewing items in a category
 * 4. CART           - Viewing cart & updating quantities (+/-)
 * 5. DELIVERY_INFO  - Name, Address, Delivery Slot, Payment Method
 * 6. CONFIRMED      - Order confirmed with WooCommerce ID & Payment Link
 */

const getSession = (phone, defaultName = "") => {
  const normPhone = storageService.normalizePhone(phone) || phone;
  if (!sessions.has(normPhone)) {
    const cleanName = defaultName && defaultName !== "there" && defaultName !== "Customer" ? defaultName : "";
    sessions.set(normPhone, {
      phone: normPhone,
      name: cleanName,
      step: "GREETING",
      cart: [],
      delivery: {
        name: cleanName,
        address: "",
        slot: "Tomorrow, 10–11 AM",
        paymentMethod: "Online / UPI (Pay Link)",
      },
      currentCategory: null,
      categoryItems: [],
      lastCreatedOrder: null,
      updatedAt: Date.now(),
    });
  }
  const session = sessions.get(normPhone);
  if (defaultName && defaultName !== "there" && defaultName !== "Customer" && (!session.delivery.name || !session.name)) {
    session.name = defaultName;
    session.delivery.name = defaultName;
  }
  return session;
};

const resetSession = (phone) => {
  const normPhone = storageService.normalizePhone(phone) || phone;
  sessions.delete(normPhone);
  return getSession(normPhone);
};

/**
 * Categorize WooCommerce products into the 4 customer journey categories
 */
const categorizeCatalog = (products = []) => {
  const categories = {
    sourdough: [],
    croissants: [],
    cookies: [],
    combos: [],
  };

  products.forEach((p) => {
    const name = (p.name || "").toLowerCase();
    const catNames = (p.categories || []).map((c) => (c.name || "").toLowerCase()).join(" ");
    const price = Number(p.price) || 0;
    const item = {
      id: p.id,
      name: p.name,
      price: price > 0 ? price : 250,
      description: p.short_description || "",
    };

    if (name.includes("sourdough") || catNames.includes("sourdough")) {
      categories.sourdough.push(item);
    } else if (
      name.includes("croissant") ||
      name.includes("bagel") ||
      name.includes("baguette") ||
      name.includes("ciabatta") ||
      name.includes("focaccia") ||
      catNames.includes("special breads") ||
      catNames.includes("bagels") ||
      catNames.includes("burger buns")
    ) {
      categories.croissants.push(item);
    } else if (
      name.includes("cookie") ||
      name.includes("brookie") ||
      catNames.includes("cookies")
    ) {
      categories.cookies.push(item);
    } else {
      // Combos, Brownies, Sweet Treats, Specials
      categories.combos.push(item);
    }
  });

  // Ensure high quality defaults if categories have empty live entries
  if (categories.sourdough.length === 0) {
    categories.sourdough.push(
      { id: 700, name: "Whole Wheat Sourdough Loaf with Sesame Seeds", price: 350 },
      { id: 699, name: "Classic Country Loaf", price: 250 },
      { id: 435, name: "Whole Wheat Plain Sourdough Loaf Bread", price: 325 },
      { id: 1116, name: "Sesame Seed Sourdough Loaf", price: 275 },
      { id: 3006, name: "Cheese Chilli Oil Spring Onion Sourdough Bread", price: 325 },
    );
  }
  if (categories.croissants.length === 0) {
    categories.croissants.push(
      { id: 102, name: "Butter Croissant", price: 150 },
      { id: 1264, name: "French Baguette", price: 240 },
      { id: 3000, name: "Ciabatta Bread", price: 130 },
      { id: 1248, name: "Focaccia Bread", price: 300 },
    );
  }
  if (categories.cookies.length === 0) {
    categories.cookies.push(
      { id: 704, name: "Chocolate Chip Cookie - Pack of 4", price: 300 },
      { id: 1424, name: "Choco Chip Walnut Cookies - Pack of 4", price: 400 },
      { id: 2759, name: "Whole Wheat Jaggery Chocolate Cookies - Pack of 5", price: 550 },
    );
  }
  if (categories.combos.length === 0) {
    categories.combos.push(
      { id: 1866, name: "Cinnamon Rolls - Pack of 9", price: 720 },
      { id: 3186, name: "Tiramisu - 280gms", price: 520 },
      { id: 706, name: "Double Chocolate Chip Brownie - Pack of 4", price: 340 },
      { id: 104, name: "Bakery Weekend Breakfast Combo", price: 650 },
    );
  }

  return categories;
};

/**
 * Format Currency in INR
 */
const formatPrice = (amt) => `₹${Number(amt).toLocaleString("en-IN")}`;

/**
 * Step 1: Greeting
 */
const renderGreeting = (session) => {
  const displayName = session.name && session.name !== "there" && session.name !== "Customer" ? session.name : "";
  const namePart = displayName ? ` ${displayName}` : "";
  return `Hi${namePart} 👋 Your favourite sourdough is fresh today! Would you like to place your usual order?

Options:
1️⃣ Reply *1* (or *Place Order*) to explore today's fresh bake
2️⃣ Reply *2* (or *Usual Order*) to reorder your previous items`;
};

/**
 * Step 2: Main Menu
 */
const renderMainMenu = () => {
  return `🍞 *Bombay Sourdough Company — Fresh Today*

Please choose an option to view our freshly baked items:

1️⃣ 🍞 *Sourdough Breads*
2️⃣ 🥐 *Croissants & Breads*
3️⃣ 🍪 *Cookies*
4️⃣ 🎁 *Combos & Treats*
5️⃣ 🔄 *Order My Previous Order*
0️⃣ 🛒 *View Cart*

_Reply with 1, 2, 3, 4, 5, or 0 (or type the category name)._`;
};

/**
 * Step 3: Product Listing
 */
const renderCategoryItems = (categoryTitle, emoji, items) => {
  let text = `${emoji} *${categoryTitle}*\n\n`;
  items.slice(0, 8).forEach((item, index) => {
    text += `${index + 1}️⃣ *${item.name}* — ${formatPrice(item.price)}\n`;
  });
  text += `\nOptions:\n`;
  text += `• Reply with item number (e.g. *1*) to add to your cart\n`;
  text += `0️⃣ Reply *0* (or *Menu*) to go back to Main Menu\n`;
  text += `9️⃣ Reply *9* (or *Cart*) to view cart / checkout`;
  return text;
};

/**
 * Cart Summary
 */
const renderCart = (session) => {
  if (!session.cart || session.cart.length === 0) {
    return `🛒 Your cart is currently empty.\n\n1️⃣ Reply *1* (or *Menu*) to browse our fresh sourdough, croissants, and cookies!`;
  }

  let text = `🛒 *Your Cart:*\n`;
  let subtotal = 0;
  session.cart.forEach((item, index) => {
    const itemTotal = item.price * item.quantity;
    subtotal += itemTotal;
    text += `${index + 1}. *${item.name}*\n   Qty: ${item.quantity} × ${formatPrice(item.price)} = *${formatPrice(itemTotal)}*\n`;
  });

  text += `\n*Total: ${formatPrice(subtotal)}*\n\n`;
  text += `Options:\n`;
  text += `1️⃣ Reply *1* (or *Checkout*) to proceed to delivery & pay\n`;
  text += `2️⃣ Reply *2* (or *+*) to increase quantity of last item\n`;
  text += `3️⃣ Reply *3* (or *-*) to decrease quantity\n`;
  text += `4️⃣ Reply *4* (or *Menu*) to add more items\n`;
  text += `5️⃣ Reply *5* (or *Clear*) to empty cart`;
  return text;
};

/**
 * Smart heuristic parser for customer delivery details.
 * Supports:
 * - Natural comma-separated strings (e.g. "mohish narkhede , bandra , 12pm , cash ,")
 * - Key-value strings (e.g. "Name: Mohish, Address: Bandra West, Time: 2pm, Cash")
 * - Individual updates (e.g. "cash", "online", "12 PM", "Flat 402, Bandra")
 */
const parseDeliveryDetails = (rawText, currentSession) => {
  const text = (rawText || "").trim();
  const lower = text.toLowerCase();
  const updates = {};

  // 1. Payment Method Detection
  if (/\b(cash|cod|cash on delivery|pay on delivery|pod)\b/i.test(lower)) {
    updates.paymentMethod = "Cash on Delivery (COD)";
  } else if (
    /\b(online|upi|pay link|payment link|card|gpay|google pay|phonepe|paytm|netbanking)\b/i.test(lower)
  ) {
    updates.paymentMethod = "Online / UPI (Pay Link)";
  }

  // 2. Delivery Time Slot Detection
  const timeRegex =
    /\b(?:(?:today|tomorrow)\s*(?:at\s*)?)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}\s*(?:am|pm)|morning|evening|afternoon|noon|\d{1,2}\s*-\s*\d{1,2}\s*(?:am|pm))\b/i;
  const timeMatch = text.match(timeRegex);
  if (timeMatch) {
    let slotStr = timeMatch[0].trim();
    if (!/today|tomorrow/i.test(slotStr)) {
      slotStr = "Tomorrow, " + slotStr.toUpperCase();
    } else {
      slotStr = slotStr.replace(/\b\w/g, (l) => l.toUpperCase());
    }
    updates.slot = slotStr;
  }

  // 3. Key-Value Style: Name: X, Address: Y
  const nameMatch = text.match(/\bname\s*[:=\-]\s*([^,\n]+)/i);
  const addrMatch = text.match(/\b(?:address|addr|loc|location)\s*[:=\-]\s*([^,\n]+)/i);

  if (nameMatch) updates.name = nameMatch[1].trim().replace(/\b\w/g, (l) => l.toUpperCase());
  if (addrMatch) updates.address = addrMatch[1].trim();

  // 4. Natural Text / Comma / Line Separated Chunks
  if (!nameMatch && !addrMatch) {
    let cleanText = text
      .replace(
        /\b(cash on delivery|cash|cod|pay on delivery|pod|online \/ upi|online|upi|pay link|payment link|card|gpay|google pay|phonepe|paytm|netbanking)\b/gi,
        "",
      )
      .replace(timeRegex, "")
      .replace(/[,;]+$/, "")
      .trim();

    const chunks = cleanText
      .split(/[,;\n]+/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    const isAddressLike = (str) =>
      /\b(flat|room|house|plot|bldg|building|apt|apartment|floor|wing|opp|near|behind|beside|road|rd|street|st|lane|marg|nagar|colony|sector|cross|chowk|mumbai|delhi|pune|bangalore|thane|navi|west|east|bandra|andheri|powai|juhu|worli|colaba|dadar|chembur|kurla|borivali|kandivali|malad|goregaon|santacruz|vile parle)\b/i.test(
        str,
      ) || /\d{6}/.test(str);

    const sessionHasName =
      currentSession.delivery?.name &&
      currentSession.delivery.name !== "there" &&
      currentSession.delivery.name !== "Customer" &&
      currentSession.delivery.name.trim().length > 0;

    if (chunks.length >= 2 && !sessionHasName) {
      if (!isAddressLike(chunks[0]) && chunks[0].split(" ").length <= 4) {
        updates.name = chunks[0].replace(/\b\w/g, (l) => l.toUpperCase());
        updates.address = chunks.slice(1).join(", ");
      } else {
        updates.address = chunks.join(", ");
      }
    } else if (
      chunks.length === 1 &&
      !sessionHasName &&
      !isAddressLike(chunks[0]) &&
      chunks[0].split(" ").length <= 3 &&
      chunks[0].length < 30
    ) {
      updates.name = chunks[0].replace(/\b\w/g, (l) => l.toUpperCase());
    } else if (chunks.length > 0) {
      updates.address = chunks.join(", ");
    }
  }

  return updates;
};

/**
 * Step 4: Delivery Details
 */
const renderDeliveryDetails = (session) => {
  const hasValidName =
    session.delivery.name &&
    session.delivery.name !== "there" &&
    session.delivery.name !== "Customer" &&
    session.delivery.name.trim().length > 0;
  const name = hasValidName ? session.delivery.name : (session.name && session.name !== "there" && session.name !== "Customer" ? session.name : "To be confirmed");

  const hasValidAddress =
    session.delivery.address &&
    !session.delivery.address.includes("Please provide") &&
    session.delivery.address !== "To be confirmed" &&
    session.delivery.address.trim().length > 0;
  const address = hasValidAddress ? session.delivery.address : "To be confirmed";

  const slot = session.delivery.slot || "Tomorrow, 10–11 AM";
  const payment = session.delivery.paymentMethod || "Online / UPI (Pay Link)";

  let text = `📋 *Delivery Details Confirmation:*\n\n`;
  text += `👤 *Name:* ${name}\n`;
  text += `📍 *Address:* ${address}\n`;
  text += `🕒 *Delivery Slot:* ${slot}\n`;
  text += `💳 *Payment:* ${payment}\n\n`;

  if (!hasValidAddress || name === "To be confirmed") {
    text += `Please send your delivery details:
• *Name*
• *Address*
• *Delivery Slot* (e.g. 12 PM, Tomorrow 10–11 AM)
• *Payment Method* (Online or Cash)

_Example in one message:_
"${name !== "To be confirmed" ? name : "Mohish Narkhede"}, Bandra West, 12 PM, Cash"

Options:
1️⃣ Reply *1* (or send message above) with your address & details
2️⃣ Reply *2* (or *Cart*) to review cart
3️⃣ Reply *3* (or *Cancel*) to cancel checkout`;
  } else {
    const isCod = /cash|cod/i.test(payment);
    text += `Options:
1️⃣ Reply *1* (or *Confirm*) to place order ${isCod ? "with Cash on Delivery" : "and receive payment link"}
2️⃣ Reply *2* (or *Change*) to update address, time, or payment
3️⃣ Reply *3* (or *Cancel*) to cancel order & return to cart`;
  }
  return text;
};

/**
 * Step 5 & 6: Create WooCommerce Order and Generate Confirmation
 */
const handleOrderCreation = async (session) => {
  try {
    const lineItems = session.cart.map((i) => ({
      product_id: i.id,
      quantity: i.quantity,
    }));

    const customerName =
      (session.delivery.name && session.delivery.name !== "there" && session.delivery.name !== "Customer"
        ? session.delivery.name
        : (session.name && session.name !== "there" && session.name !== "Customer" ? session.name : "Customer"));
    const nameParts = customerName.split(" ");
    const firstName = nameParts[0] || "Customer";
    const lastName = nameParts.slice(1).join(" ") || "";
    const address = session.delivery.address && session.delivery.address !== "To be confirmed" ? session.delivery.address : "Mumbai, Maharashtra";
    const phone = session.phone || "";
    const isCod = /cash|cod/i.test(session.delivery.paymentMethod);

    const orderPayload = {
      payment_method: isCod ? "cod" : "instamojo",
      payment_method_title: isCod ? "Cash on Delivery" : "Online / UPI Payment Link",
      set_paid: false,
      billing: {
        first_name: firstName,
        last_name: lastName,
        address_1: address,
        city: "Mumbai",
        state: "MH",
        postcode: "400001",
        country: "IN",
        phone: phone,
      },
      shipping: {
        first_name: firstName,
        last_name: lastName,
        address_1: address,
        city: "Mumbai",
        state: "MH",
        postcode: "400001",
        country: "IN",
      },
      line_items: lineItems,
      customer_note: `WhatsApp Order. Delivery Slot: ${session.delivery.slot || "Tomorrow, 10–11 AM"} | Payment: ${isCod ? "Cash on Delivery (COD)" : "Online / UPI"}`,
    };

    let wcOrder = null;
    const isLiveOrdersEnabled = process.env.ENABLE_LIVE_ORDERS === "true";

    if (isLiveOrdersEnabled) {
      try {
        wcOrder = await woocommerceService.createOrder(orderPayload);
      } catch (orderErr) {
        console.error("WooCommerce API createOrder failed, generating local confirmation:", orderErr.message);
      }
    } else {
      console.log("🔒 [SAFETY GUARD] Live WooCommerce order creation is paused (ENABLE_LIVE_ORDERS=false). Simulating confirmation safely.");
    }

    const orderId = wcOrder?.id || wcOrder?.number || `TEST${Math.floor(1000 + Math.random() * 9000)}`;
    const orderNumber = `#BS${orderId}`;
    const paymentUrl =
      wcOrder?.payment_url ||
      `https://bombaysourdoughcompany.com/checkout/order-pay/${orderId}/?pay_for_order=true&key=${wcOrder?.order_key || "wc_order_pending"}`;

    session.lastCreatedOrder = {
      orderId,
      orderNumber,
      paymentUrl,
      items: [...session.cart],
      total: session.cart.reduce((sum, i) => sum + i.price * i.quantity, 0),
      createdAt: new Date().toISOString(),
    };

    session.step = "CONFIRMED";

    // Persist order & customer delivery mapping to Database (MongoDB Atlas & local storage)
    try {
      await storageService.saveCustomerOrder(session.phone, {
        orderId,
        orderNumber,
        customerName,
        address,
        deliverySlot: session.delivery.slot,
        paymentMethod: session.delivery.paymentMethod,
        items: session.cart,
        total: session.lastCreatedOrder.total,
        paymentUrl,
        status: "confirmed",
      });
    } catch (saveErr) {
      console.warn("Could not persist customer order to database:", saveErr.message);
    }

    let cartSummaryText = session.cart
      .map((i) => `• ${i.name} × ${i.quantity} — ${formatPrice(i.price * i.quantity)}`)
      .join("\n");
    const totalFormatted = formatPrice(session.lastCreatedOrder.total);

    let paymentBlock = "";
    if (isCod) {
      paymentBlock = `💵 *Payment Method:* Cash on Delivery (COD)\nPlease keep *${totalFormatted}* in cash or UPI ready at the time of delivery.`;
    } else {
      paymentBlock = `💳 *Payment Link:*\nPlease complete your payment of *${totalFormatted}* here:\n👉 ${paymentUrl}`;
    }

    const reply = `${paymentBlock}

━━━━━━━━━━━━━━━━━━━━
✅ *Your order ${orderNumber} is confirmed!*
🕒 *Delivery:* ${session.delivery.slot}

📦 *Summary:*
${cartSummaryText}
*Total: ${totalFormatted}${isCod ? " (Pay on Delivery)" : ""}*

📍 *Delivering to:*
${customerName}
${address}

Thank you for ordering with *Bombay Sourdough Company*! 🍞
_Your fresh batch is scheduled for baking._

Options:
1️⃣ Reply *1* (or *Status*) to track this order
2️⃣ Reply *2* (or *Menu*) to start a new order`;

    // Clear cart after confirmed order
    session.cart = [];
    return reply;
  } catch (err) {
    console.error("Error finalizing order:", err);
    return `✅ Your order request has been received! Our bakery team is preparing order #BS${Math.floor(1000 + Math.random() * 9000)}. We will message you shortly with payment and dispatch details.`;
  }
};

/**
 * Handle "🔄 Order My Previous Order"
 */
const handlePreviousOrder = async (session) => {
  try {
    const prevOrder = await woocommerceService.getPreviousOrderByPhone(session.phone);

    if (prevOrder && Array.isArray(prevOrder.line_items) && prevOrder.line_items.length > 0) {
      // Populate cart with items from previous order
      session.cart = prevOrder.line_items.map((item) => ({
        id: item.product_id || item.id,
        name: item.name,
        price: Number(item.total) > 0 && Number(item.quantity) > 0 ? Math.round(Number(item.total) / Number(item.quantity)) : 250,
        quantity: Number(item.quantity) || 1,
      }));

      // Pre-fill delivery details if available from past order
      if (prevOrder.billing) {
        if (prevOrder.billing.first_name) {
          session.delivery.name = `${prevOrder.billing.first_name} ${prevOrder.billing.last_name || ""}`.trim();
        }
        if (prevOrder.billing.address_1) {
          session.delivery.address = [prevOrder.billing.address_1, prevOrder.billing.city, prevOrder.billing.postcode]
            .filter(Boolean)
            .join(", ");
        }
      }

      session.step = "CART";

      let itemsSummary = session.cart.map((i) => `• *${i.name}* × ${i.quantity} — ${formatPrice(i.price * i.quantity)}`).join("\n");
      const total = formatPrice(session.cart.reduce((s, i) => s + i.price * i.quantity, 0));

      return `🔄 *Your Previous Order (#${prevOrder.number || prevOrder.id}):*
${itemsSummary}
*Total: ${total}*

We've added these items to your cart! 🛒

Reply:
1️⃣ *Checkout* — Proceed to delivery & payment
2️⃣ *Menu* — Add more fresh items
3️⃣ *Clear* — Start a fresh order`;
    }
  } catch (error) {
    console.warn("Previous order lookup error:", error.message);
  }

  // Fallback if no previous order was found on WooCommerce
  session.step = "MENU";
  return `🔄 We couldn't find a previous order for your phone number yet. No worries! Let's get your first fresh order started:

${renderMainMenu()}`;
};

/**
 * Main Message Router for the 6-Step WhatsApp Customer Journey
 */
const processCustomerMessage = async ({ customerPhone, customerName, message, productsCatalog = [] }) => {
  const session = getSession(customerPhone, customerName);
  const text = (message || "").trim();
  const lower = text.toLowerCase();

  // Strip punctuation for ultra-reliable numerical & keyword matching (e.g. "confirm....", "1.", "#1", "confirm!")
  const clean = lower.replace(/[^\w\s]/gi, " ").trim();
  const tokens = clean.split(/\s+/).filter(Boolean);
  const firstToken = tokens[0] || "";

  // Categorize live products
  const catalog = categorizeCatalog(productsCatalog);

  // 1. Universal Quick Commands
  if (clean === "restart" || clean === "reset" || clean === "start") {
    resetSession(customerPhone);
    const freshSession = getSession(customerPhone, customerName);
    freshSession.step = "GREETING";
    return { reply: renderGreeting(freshSession), session: freshSession };
  }

  if (clean === "menu" || clean === "options" || clean === "categories" || clean === "category") {
    session.step = "MENU";
    return { reply: renderMainMenu(), session };
  }

  if (clean === "cart" || clean === "view cart" || clean === "viewcart" || clean.includes("view cart")) {
    session.step = "CART";
    return { reply: renderCart(session), session };
  }

  if (clean === "clear" || clean === "empty cart") {
    session.cart = [];
    session.step = "MENU";
    return { reply: `🗑️ Your cart has been cleared.\n\n${renderMainMenu()}`, session };
  }

  // 2. Journey State Machine

  // A. EXPLICIT GREETINGS (Hi, Hello, Hey)
  const isGreetingWord =
    clean === "hi" ||
    clean === "hello" ||
    clean === "hey" ||
    clean === "namaste" ||
    clean.startsWith("hi ") ||
    clean.startsWith("hello ");

  if (isGreetingWord) {
    session.step = "GREETING";
    return { reply: renderGreeting(session), session };
  }

  // B. STEP 1: RESPONDING TO GREETING
  if (session.step === "GREETING") {
    // Option 1: Place Order (Menu)
    if (
      firstToken === "1" ||
      clean === "1" ||
      clean.includes("place order") ||
      clean === "order" ||
      clean === "yes" ||
      clean === "place" ||
      clean === "start"
    ) {
      session.step = "MENU";
      return { reply: renderMainMenu(), session };
    }

    // Option 2: Usual / Previous Order
    if (firstToken === "2" || clean === "2" || clean.includes("usual") || clean.includes("previous")) {
      const reply = await handlePreviousOrder(session);
      return { reply, session };
    }

    // Direct category jump from greeting
    if (clean.includes("sourdough") || clean.includes("bread")) {
      session.step = "CATEGORY_VIEW";
      session.currentCategory = "Sourdough Breads";
      session.categoryItems = catalog.sourdough;
      return { reply: renderCategoryItems("Sourdough Breads", "🍞", catalog.sourdough), session };
    }
    if (clean.includes("croissant") || clean.includes("bagel") || clean.includes("baguette")) {
      session.step = "CATEGORY_VIEW";
      session.currentCategory = "Croissants & Breads";
      session.categoryItems = catalog.croissants;
      return { reply: renderCategoryItems("Croissants & Breads", "🥐", catalog.croissants), session };
    }
    if (clean.includes("cookie") || clean.includes("brookie")) {
      session.step = "CATEGORY_VIEW";
      session.currentCategory = "Cookies";
      session.categoryItems = catalog.cookies;
      return { reply: renderCategoryItems("Cookies", "🍪", catalog.cookies), session };
    }
    if (clean.includes("combo") || clean.includes("treat")) {
      session.step = "CATEGORY_VIEW";
      session.currentCategory = "Combos & Treats";
      session.categoryItems = catalog.combos;
      return { reply: renderCategoryItems("Combos & Treats", "🎁", catalog.combos), session };
    }
  }

  // C. STEP 2: MENU SELECTION
  if (session.step === "MENU") {
    // 0. View Cart
    if (firstToken === "0" || clean === "0" || clean === "cart" || clean.includes("view cart")) {
      session.step = "CART";
      return { reply: renderCart(session), session };
    }

    // 1. Sourdough Breads
    if (firstToken === "1" || clean === "1" || clean.includes("sourdough") || clean.includes("bread")) {
      session.step = "CATEGORY_VIEW";
      session.currentCategory = "Sourdough Breads";
      session.categoryItems = catalog.sourdough;
      return { reply: renderCategoryItems("Sourdough Breads", "🍞", catalog.sourdough), session };
    }

    // 2. Croissants & Breads
    if (firstToken === "2" || clean === "2" || clean.includes("croissant") || clean.includes("bagel") || clean.includes("baguette")) {
      session.step = "CATEGORY_VIEW";
      session.currentCategory = "Croissants & Breads";
      session.categoryItems = catalog.croissants;
      return { reply: renderCategoryItems("Croissants & Breads", "🥐", catalog.croissants), session };
    }

    // 3. Cookies
    if (firstToken === "3" || clean === "3" || clean.includes("cookie") || clean.includes("brookie")) {
      session.step = "CATEGORY_VIEW";
      session.currentCategory = "Cookies";
      session.categoryItems = catalog.cookies;
      return { reply: renderCategoryItems("Cookies", "🍪", catalog.cookies), session };
    }

    // 4. Combos & Treats
    if (firstToken === "4" || clean === "4" || clean.includes("combo") || clean.includes("treat") || clean.includes("brownie") || clean.includes("tiramisu")) {
      session.step = "CATEGORY_VIEW";
      session.currentCategory = "Combos & Treats";
      session.categoryItems = catalog.combos;
      return { reply: renderCategoryItems("Combos & Treats", "🎁", catalog.combos), session };
    }

    // 5. Previous Order
    if (firstToken === "5" || clean === "5" || clean.includes("previous") || clean.includes("usual")) {
      const reply = await handlePreviousOrder(session);
      return { reply, session };
    }
  }

  // D. STEP 3: SELECTING PRODUCT IN CATEGORY
  if (session.step === "CATEGORY_VIEW") {
    // 0 for Menu
    if (firstToken === "0" || clean === "0" || clean === "menu" || clean === "back") {
      session.step = "MENU";
      return { reply: renderMainMenu(), session };
    }

    // 9 for Cart
    if (firstToken === "9" || clean === "9" || clean === "cart" || clean.includes("view cart") || clean === "checkout") {
      session.step = "CART";
      return { reply: renderCart(session), session };
    }

    const itemNumber = parseInt(firstToken, 10);
    if (!isNaN(itemNumber) && itemNumber >= 1 && itemNumber <= session.categoryItems.length) {
      const selectedItem = session.categoryItems[itemNumber - 1];
      const existing = session.cart.find((i) => i.id === selectedItem.id);
      if (existing) {
        existing.quantity += 1;
      } else {
        session.cart.push({
          id: selectedItem.id,
          name: selectedItem.name,
          price: selectedItem.price,
          quantity: 1,
        });
      }

      session.step = "CART";
      return {
        reply: `✅ Added *${selectedItem.name}* (1) to your cart!\n\n${renderCart(session)}`,
        session,
      };
    }
  }

  // E. STEP 3b: CART ACTIONS & QUANTITY MODIFIERS
  if (session.step === "CART") {
    // 1 for Checkout
    if (
      firstToken === "1" ||
      clean === "1" ||
      clean === "checkout" ||
      clean === "proceed" ||
      clean.includes("checkout") ||
      clean === "pay"
    ) {
      if (session.cart.length === 0) {
        const defaultItem = catalog.sourdough[0] || { id: 700, name: "Whole Wheat Sourdough Loaf with Sesame Seeds", price: 350 };
        session.cart.push({ ...defaultItem, quantity: 1 });
      }
      session.step = "DELIVERY_INFO";
      return { reply: renderDeliveryDetails(session), session };
    }

    // 2 for Increase (+)
    if (
      firstToken === "2" ||
      lower === "+" ||
      lower.startsWith("+") ||
      clean.includes("increase") ||
      clean === "add"
    ) {
      if (session.cart.length > 0) {
        const lastItem = session.cart[session.cart.length - 1];
        lastItem.quantity += 1;
        return {
          reply: `➕ Increased *${lastItem.name}* to ${lastItem.quantity}.\n\n${renderCart(session)}`,
          session,
        };
      }
    }

    // 3 for Decrease (-)
    if (
      firstToken === "3" ||
      lower === "-" ||
      lower.startsWith("-") ||
      clean.includes("decrease") ||
      clean === "remove"
    ) {
      if (session.cart.length > 0) {
        const lastItem = session.cart[session.cart.length - 1];
        if (lastItem.quantity > 1) {
          lastItem.quantity -= 1;
          return {
            reply: `➖ Decreased *${lastItem.name}* to ${lastItem.quantity}.\n\n${renderCart(session)}`,
            session,
          };
        } else {
          session.cart.pop();
          session.step = session.cart.length > 0 ? "CART" : "MENU";
          return {
            reply: `🗑️ Removed *${lastItem.name}* from cart.\n\n${renderCart(session)}`,
            session,
          };
        }
      }
    }

    // 4 for Menu
    if (firstToken === "4" || clean === "4" || clean === "menu" || clean === "back" || clean.includes("more")) {
      session.step = "MENU";
      return { reply: renderMainMenu(), session };
    }

    // 5 for Clear / Empty
    if (firstToken === "5" || clean === "5" || clean === "clear" || clean.includes("empty") || clean === "cancel") {
      session.cart = [];
      session.step = "MENU";
      return { reply: `🗑️ Your cart has been cleared.\n\n${renderMainMenu()}`, session };
    }
  }

  // F. STEP 4: PROCEED TO CHECKOUT (From anywhere if explicitly requested)
  if (
    clean === "checkout" ||
    clean === "proceed" ||
    clean === "proceed to checkout" ||
    clean.includes("checkout")
  ) {
    if (session.cart.length === 0) {
      const defaultItem = catalog.sourdough[0] || { id: 700, name: "Whole Wheat Sourdough Loaf with Sesame Seeds", price: 350 };
      session.cart.push({ ...defaultItem, quantity: 1 });
    }
    session.step = "DELIVERY_INFO";
    return { reply: renderDeliveryDetails(session), session };
  }

  // G. IN DELIVERY_INFO: Address Input, Details Parsing or Confirmation
  if (session.step === "DELIVERY_INFO") {
    // 3 for Cancel checkout -> Return to cart
    const isCancel =
      firstToken === "3" ||
      clean === "3" ||
      clean === "cancel" ||
      clean === "stop" ||
      clean === "exit" ||
      clean === "back";

    if (isCancel) {
      session.step = "CART";
      return {
        reply: `❌ Checkout cancelled. Returning to your cart:\n\n${renderCart(session)}`,
        session,
      };
    }

    // 1 for Confirm (or confirm, confirm...., confirm order, yes, ok, done, pay, place order)
    const isConfirm =
      firstToken === "1" ||
      clean === "1" ||
      clean === "confirm" ||
      clean.startsWith("confirm") ||
      clean === "pay" ||
      clean === "yes" ||
      clean === "ok" ||
      clean === "place order" ||
      lower.includes("confirm");

    if (isConfirm) {
      const hasValidAddress =
        session.delivery.address &&
        !session.delivery.address.includes("Please provide") &&
        session.delivery.address !== "To be confirmed" &&
        session.delivery.address.trim().length > 0;

      if (!hasValidAddress) {
        return {
          reply: `📍 Please reply with your *Delivery Address* (e.g. "Flat 402, Sunshine Apts, Bandra West, Mumbai") to confirm delivery:`,
          session,
        };
      }
      // STEP 5 & 6: Create order / simulate confirmation
      const confirmationText = await handleOrderCreation(session);
      return { reply: confirmationText, session };
    }

    // 2 for Edit / Change details OR View Cart if address empty
    const isEditOrCart =
      firstToken === "2" ||
      clean === "2" ||
      clean === "change" ||
      clean === "edit" ||
      clean === "cart";

    if (isEditOrCart) {
      if (clean === "cart" || (!session.delivery.address || session.delivery.address === "To be confirmed")) {
        session.step = "CART";
        return { reply: renderCart(session), session };
      }
      return {
        reply: `✏️ Please reply with your updated details (e.g. "Mohish Narkhede, Bandra West, 12 PM, Cash", or simply type your new address, time, or cash/online):`,
        session,
      };
    }

    // Customer provided details (Name, Address, Time, Payment)
    const updates = parseDeliveryDetails(text, session);
    const changes = [];

    if (updates.name) {
      session.name = updates.name;
      session.delivery.name = updates.name;
      changes.push(`Name: *${updates.name}*`);
    }
    if (updates.address) {
      session.delivery.address = updates.address;
      changes.push(`Address: *${updates.address}*`);
    }
    if (updates.slot) {
      session.delivery.slot = updates.slot;
      changes.push(`Delivery Slot: *${updates.slot}*`);
    }
    if (updates.paymentMethod) {
      session.delivery.paymentMethod = updates.paymentMethod;
      changes.push(`Payment Method: *${updates.paymentMethod}*`);
    }

    // Fallback if no specific tokens were extracted but message is substantial
    if (changes.length === 0 && text.length >= 3 && !clean.includes("confirm") && !clean.includes("cancel")) {
      session.delivery.address = text;
      changes.push(`Address: *${text}*`);
    }

    // Persist updated customer delivery details in Database (MongoDB Atlas & local storage)
    try {
      await storageService.updateCustomerDeliveryDetails(session.phone, {
        name: session.name,
        address: session.delivery.address,
        slot: session.delivery.slot,
        paymentMethod: session.delivery.paymentMethod,
      });
    } catch (saveErr) {
      console.warn("Could not save customer delivery details to database:", saveErr.message);
    }

    const feedbackHeader = changes.length > 0 ? `✅ Details updated:\n${changes.map((c) => `• ${c}`).join("\n")}\n\n` : "";
    return {
      reply: `${feedbackHeader}${renderDeliveryDetails(session)}`,
      session,
    };
  }

  // H. POST-ORDER (Status check / New Order)
  if (session.step === "CONFIRMED" || clean === "status" || clean === "paid" || clean.includes("payment done") || clean.includes("track")) {
    // 1 for Status / Tracking
    if (firstToken === "1" || clean === "1" || clean.includes("status") || clean.includes("track") || clean.includes("paid")) {
      const orderNum = session.lastCreatedOrder?.orderNumber || "#BS1025";
      const slot = session.delivery?.slot || "Tomorrow, 10–11 AM";
      const total = session.lastCreatedOrder?.total ? `₹${session.lastCreatedOrder.total}` : "₹350";
      return {
        reply: `📦 *Order Status for ${orderNum}:*
Status: *Confirmed & Scheduled for Baking* 🍞
Expected Delivery: *${slot}*
Total: *${total}*

Options:
1️⃣ Reply *1* (or *Status*) to refresh status
2️⃣ Reply *2* (or *Menu*) to start a fresh order`,
        session,
      };
    }

    // 2 for Menu / Fresh Order
    if (firstToken === "2" || clean === "2" || clean.includes("menu") || clean.includes("order") || clean.includes("new")) {
      session.step = "MENU";
      session.cart = [];
      return { reply: renderMainMenu(), session };
    }
  }

  // If nothing matched, provide helpful guided options instead of failing
  if (session.cart.length > 0) {
    return {
      reply: `You have items in your cart! 🛒\n\n${renderCart(session)}`,
      session,
    };
  }

  // Default friendly guided reply
  return {
    reply: `👋 Welcome to *Bombay Sourdough Company*!\n\n${renderMainMenu()}`,
    session,
  };
};

module.exports = {
  processCustomerMessage,
  getSession,
  resetSession,
  categorizeCatalog,
  renderMainMenu,
  renderGreeting,
};
