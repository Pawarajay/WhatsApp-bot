const env = require("./env");

const getWooCommerceAuthHeader = () => {
  const { consumerKey, consumerSecret } = env.woocommerce;
  if (!consumerKey || !consumerSecret) {
    return null;
  }
  const credentials = `${consumerKey}:${consumerSecret}`;
  const encoded = Buffer.from(credentials).toString("base64");
  return `Basic ${encoded}`;
};

module.exports = {
  baseUrl: env.woocommerce.url,
  getAuthHeader: getWooCommerceAuthHeader,
};

