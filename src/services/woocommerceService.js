const axios = require("axios");
const wooConfig = require("../config/woocommerce");

let orderCountsCache = null;
let orderCountsCachedAt = 0;
let productsCache = null;
let productsCachedAt = 0;
const PRODUCTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const getAxiosInstance = () => {
  const authHeader = wooConfig.getAuthHeader();
  const headers = {
    "Content-Type": "application/json",
  };
  if (authHeader) {
    headers["Authorization"] = authHeader;
  }
  return axios.create({
    baseURL: wooConfig.baseUrl,
    headers,
    timeout: 25000,
    family: 4, // Force IPv4 to prevent IPv6 DNS timeout delays
  });
};

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const shouldRetry = (error) =>
  !error.response || (error.response.status >= 500 && error.response.status < 600);

const getWithRetry = async (client, path, config, attempt = 0) => {
  try {
    return await client.get(path, config);
  } catch (error) {
    if (attempt >= 2 || !shouldRetry(error)) {
      throw error;
    }
    await sleep(500 * (attempt + 1));
    return getWithRetry(client, path, config, attempt + 1);
  }
};

const getPageCount = (headers) =>
  Number.parseInt(headers["x-wp-totalpages"] || headers["X-WP-TotalPages"], 10);

const fetchAllPages = async (client, path, params) => {
  const firstResponse = await getWithRetry(client, path, {
    params: { ...params, page: 1 },
  });
  const firstPage = Array.isArray(firstResponse.data) ? firstResponse.data : [];
  const totalPages = getPageCount(firstResponse.headers);

  if (!Number.isFinite(totalPages) || totalPages <= 1) {
    return firstPage;
  }

  const remainingPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      getWithRetry(client, path, {
        params: { ...params, page: index + 2 },
      }),
    ),
  );

  return [
    ...firstPage,
    ...remainingPages.flatMap((response) =>
      Array.isArray(response.data) ? response.data : [],
    ),
  ];
};

const getProducts = async (params = {}) => {
  const isDefaultFetch = Object.keys(params).length === 0;
  if (isDefaultFetch && productsCache && Date.now() - productsCachedAt < PRODUCTS_CACHE_TTL) {
    return productsCache;
  }

  try {
    const client = getAxiosInstance();
    const requestedPerPage = Number.parseInt(params.per_page, 10);
    const perPage = Number.isFinite(requestedPerPage)
      ? Math.min(Math.max(requestedPerPage, 1), 100)
      : 100;
    const products = await fetchAllPages(client, "/wp-json/wc/v3/products", {
      ...params,
      per_page: perPage,
    });

    if (isDefaultFetch && Array.isArray(products) && products.length > 0) {
      productsCache = products;
      productsCachedAt = Date.now();
    }

    return products;
  } catch (error) {
    console.error("WooCommerce getProducts error:", error.response?.data || error.message);
    if (productsCache) {
      console.warn("Returning cached products due to WooCommerce fetch error");
      return productsCache;
    }
    throw error;
  }
};

const getProductById = async (id) => {
  if (productsCache) {
    const cached = productsCache.find((p) => String(p.id) === String(id));
    if (cached) return cached;
  }
  try {
    const client = getAxiosInstance();
    const response = await getWithRetry(client, `/wp-json/wc/v3/products/${id}`, {});
    return response.data;
  } catch (error) {
    console.error(`WooCommerce getProductById (${id}) error:`, error.response?.data || error.message);
    throw error;
  }
};

const getOrders = async (params = {}) => {
  try {
    const client = getAxiosInstance();
    const requestedPerPage = Number.parseInt(params.per_page, 10);
    const perPage = Number.isFinite(requestedPerPage)
      ? Math.min(Math.max(requestedPerPage, 1), 100)
      : 100;
    return await fetchAllPages(client, "/wp-json/wc/v3/orders", {
      ...params,
      per_page: perPage,
    });
  } catch (error) {
    console.error("WooCommerce getOrders error:", error.response?.data || error.message);
    throw error;
  }
};

const getOrdersPage = async (params = {}) => {
  try {
    const client = getAxiosInstance();
    const requestedPage = Number.parseInt(params.page, 10);
    const requestedPerPage = Number.parseInt(params.per_page, 10);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const perPage = Number.isFinite(requestedPerPage)
      ? Math.min(Math.max(requestedPerPage, 1), 100)
      : 25;
    const response = await getWithRetry(client, "/wp-json/wc/v3/orders", {
      params: { ...params, page, per_page: perPage },
    });
    const total = Number.parseInt(response.headers["x-wp-total"], 10) || 0;
    const totalPages = Number.parseInt(response.headers["x-wp-totalpages"], 10) || 1;
    return {
      orders: Array.isArray(response.data) ? response.data : [],
      total,
      totalPages,
      page,
      perPage,
    };
  } catch (error) {
    console.error("WooCommerce getOrdersPage error:", error.response?.data || error.message);
    throw error;
  }
};

const getOrderCounts = async () => {
  if (orderCountsCache && Date.now() - orderCountsCachedAt < 30000) {
    return orderCountsCache;
  }
  const client = getAxiosInstance();
  const statuses = ["all", "pending", "processing", "on-hold", "completed", "cancelled", "qr-sent", "shipped"];
  const results = await Promise.all(statuses.map(async (status) => {
    const params = { per_page: 1 };
    if (status !== "all") params.status = status === "qr-sent" ? "qrsent" : status;
    const response = await getWithRetry(client, "/wp-json/wc/v3/orders", { params });
    return [status, Number.parseInt(response.headers["x-wp-total"], 10) || 0];
  }));
  orderCountsCache = Object.fromEntries(results);
  orderCountsCachedAt = Date.now();
  return orderCountsCache;
};

const getOrderById = async (id) => {
  try {
    const client = getAxiosInstance();
    const response = await getWithRetry(client, `/wp-json/wc/v3/orders/${id}`, {});
    return response.data;
  } catch (error) {
    console.error(`WooCommerce getOrderById (${id}) error:`, error.response?.data || error.message);
    throw error;
  }
};

const createOrder = async (orderData) => {
  try {
    const client = getAxiosInstance();
    const response = await client.post("/wp-json/wc/v3/orders", orderData);
    return response.data;
  } catch (error) {
    console.error("WooCommerce createOrder error:", error.response?.data || error.message);
    throw error;
  }
};

/**
 * Fetch the latest previous order for a given phone number
 * Used for Step 2 & 3: "🔄 Order My Previous Order"
 */
const getPreviousOrderByPhone = async (rawPhone) => {
  if (!rawPhone) return null;
  const digitsOnly = String(rawPhone).replace(/\D/g, "");
  const searchPhone = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : digitsOnly;
  if (!searchPhone) return null;

  try {
    const client = getAxiosInstance();
    // Search orders by customer's phone digits
    const response = await getWithRetry(client, "/wp-json/wc/v3/orders", {
      params: {
        search: searchPhone,
        per_page: 5,
      },
    });

    const orders = Array.isArray(response.data) ? response.data : [];
    if (orders.length === 0) return null;

    // Find the latest valid order that has line items
    const matching = orders.find((o) => {
      const billingPhone = String(o.billing?.phone || "").replace(/\D/g, "");
      const shippingPhone = String(o.shipping?.phone || "").replace(/\D/g, "");
      const matches = billingPhone.includes(searchPhone) || shippingPhone.includes(searchPhone);
      return matches && Array.isArray(o.line_items) && o.line_items.length > 0;
    });

    return matching || orders[0];
  } catch (error) {
    console.warn(`Could not retrieve previous order for ${rawPhone}:`, error.message);
    return null;
  }
};

module.exports = {
  getProducts,
  getProductById,
  getOrders,
  getOrdersPage,
  getOrderCounts,
  getOrderById,
  createOrder,
  getPreviousOrderByPhone,
};
