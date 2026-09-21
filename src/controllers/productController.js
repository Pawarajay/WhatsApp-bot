const woocommerceService = require("../services/woocommerceService");

const getProducts = async (req, res) => {
  try {
    const products = await woocommerceService.getProducts(req.query);
    res.json({
      success: true,
      data: products,
      count: products.length,
      source: "woocommerce",
    });
  } catch (error) {
    console.error("Product catalog unavailable:", error.response?.data || error.message);
    res.status(503).json({
      success: false,
      code: "PRODUCT_CATALOG_UNAVAILABLE",
      message: "Product catalog is unavailable. No fallback stock data was used.",
    });
  }
};

const getProductById = async (req, res) => {
  try {
    const product = await woocommerceService.getProductById(req.params.id);
    res.json({
      success: true,
      data: product,
      source: "woocommerce",
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: "Product not found or unavailable",
    });
  }
};

module.exports = {
  getProducts,
  getProductById,
};
