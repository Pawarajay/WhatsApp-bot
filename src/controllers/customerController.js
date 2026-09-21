const storageService = require("../db/storageService");

const getCustomers = async (req, res) => {
  try {
    const customers = await storageService.getCustomerStats();
    res.json({
      success: true,
      data: customers,
      count: customers.length,
    });
  } catch (error) {
    console.error("Failed to fetch customers:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch customers",
    });
  }
};

module.exports = {
  getCustomers,
};
