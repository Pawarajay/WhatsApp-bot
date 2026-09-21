const { Type } = require("@google/genai");
const woocommerceService = require("../woocommerceService");
const storageService = require("../../db/storageService");

let cachedProducts = null;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

const loadProducts = async () => {
  if (cachedProducts && Date.now() - cachedAt < CACHE_TTL) {
    return cachedProducts;
  }
  const products = await woocommerceService.getProducts();
  cachedProducts = products;
  cachedAt = Date.now();
  return products;
};

const summarizeProduct = (p) => ({
  id: p.id,
  name: p.name,
  price: Number(p.price) || 0,
  inStock: p.stock_status === "instock",
  stockQuantity: p.manage_stock ? p.stock_quantity : null,
  shortDescription: (p.short_description || "").replace(/<[^>]+>/g, "").trim(),
});

const toolDeclarations = [
  {
    name: "get_products",
    description:
      "Get the full current bakery product catalog with live prices and stock status. Use this to answer 'what do you have' style questions.",
    parameters: { type: Type.OBJECT, properties: {}, required: [] },
  },
  {
    name: "search_products",
    description:
      "Search the bakery product catalog by name or keyword (e.g. 'chocolate', 'sourdough', 'cookie'). Returns matching products with live prices.",
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING, description: "Search keyword" } },
      required: ["query"],
    },
  },
  {
    name: "get_product_details",
    description: "Get full details (price, stock, description) for one specific product by its productId.",
    parameters: {
      type: Type.OBJECT,
      properties: { productId: { type: Type.NUMBER, description: "WooCommerce product ID" } },
      required: ["productId"],
    },
  },
  {
    name: "check_availability",
    description: "Check whether a given quantity of a product is currently available/in stock.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        productId: { type: Type.NUMBER },
        quantity: { type: Type.NUMBER },
      },
      required: ["productId", "quantity"],
    },
  },
  {
    name: "update_cart",
    description:
      "Replace the customer's current cart with the given list of items (productId, quantity). Always look up prices via get_products/get_product_details first — never invent a price here. Call this whenever the cart changes. Returns the updated cart and total computed from live prices, plus any productIds that could not be found.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              productId: { type: Type.NUMBER },
              quantity: { type: Type.NUMBER },
            },
            required: ["productId", "quantity"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "submit_order_for_review",
    description:
      "Call this ONLY after the customer has confirmed their cart AND provided their name and delivery address. This does NOT place the order — it saves the order summary for a human team member to review, create in WooCommerce, and send a payment link for. Never tell the customer the order is placed or paid before calling this.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        customerName: { type: Type.STRING },
        address: { type: Type.STRING },
        deliverySlot: { type: Type.STRING },
        paymentPreference: { type: Type.STRING, description: "e.g. 'Cash on Delivery' or 'Online/UPI'" },
        notes: { type: Type.STRING },
      },
      required: ["customerName", "address"],
    },
  },
];

const executeTool = async (name, args, context) => {
  const { conversation, phone, customerName } = context;

  if (name === "get_products") {
    const products = await loadProducts();
    return { products: products.map(summarizeProduct) };
  }

  if (name === "search_products") {
    const products = await loadProducts();
    const q = (args.query || "").toLowerCase();
    const matches = products.filter((p) => (p.name || "").toLowerCase().includes(q)).map(summarizeProduct);
    return { matches };
  }

  if (name === "get_product_details") {
    const products = await loadProducts();
    const product = products.find((p) => String(p.id) === String(args.productId));
    if (!product) return { error: "Product not found" };
    return summarizeProduct(product);
  }

  if (name === "check_availability") {
    const products = await loadProducts();
    const product = products.find((p) => String(p.id) === String(args.productId));
    if (!product) return { available: false, error: "Product not found" };
    const inStock = product.stock_status === "instock";
    const enoughStock = !product.manage_stock || product.stock_quantity >= args.quantity;
    return {
      available: inStock && enoughStock,
      inStock,
      stockQuantity: product.manage_stock ? product.stock_quantity : null,
    };
  }

  if (name === "update_cart") {
    const products = await loadProducts();
    const items = [];
    const notFound = [];
    for (const line of args.items || []) {
      const product = products.find((p) => String(p.id) === String(line.productId));
      if (!product) {
        notFound.push(line.productId);
        continue;
      }
      items.push({
        id: product.id,
        name: product.name,
        price: Number(product.price) || 0,
        quantity: Math.max(1, Number(line.quantity) || 1),
      });
    }
    conversation.cart = items;
    const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    return { cart: items, total, notFound: notFound.length > 0 ? notFound : undefined };
  }

  if (name === "submit_order_for_review") {
    const cart = conversation.cart || [];
    if (cart.length === 0) {
      return { error: "Cart is empty — cannot submit for review" };
    }
    const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const summary = {
      phone,
      customerName: args.customerName || customerName,
      address: args.address,
      deliverySlot: args.deliverySlot || "Not specified",
      paymentPreference: args.paymentPreference || "Not specified",
      notes: args.notes || "",
      items: cart,
      total,
      status: "pending_manual_creation",
    };

    try {
      await storageService.saveCustomerOrder(phone, {
        orderId: "",
        orderNumber: "PENDING-REVIEW",
        customerName: summary.customerName,
        address: summary.address,
        deliverySlot: summary.deliverySlot,
        paymentMethod: summary.paymentPreference,
        items: cart,
        total,
        paymentUrl: "",
        status: "pending_manual_creation",
      });
    } catch (err) {
      console.warn("Could not persist pending order for review:", err.message);
    }

    conversation.cart = [];

    return {
      submitted: true,
      summary,
      note: "Saved for team review. A staff member will confirm and share the payment link shortly.",
    };
  }

  return { error: `Unknown tool: ${name}` };
};

module.exports = { toolDeclarations, executeTool };