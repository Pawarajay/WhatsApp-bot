let mongoose;
try {
  mongoose = require("mongoose");
} catch (e) {
  mongoose = null;
}

if (!mongoose) {
  module.exports = null;
} else {
  const customerSchema = new mongoose.Schema(
    {
      phone: {
        type: String,
        required: true,
        unique: true,
        trim: true,
      },
      name: {
        type: String,
        default: "",
        trim: true,
      },
      customerSince: {
        type: Date,
        default: Date.now,
      },
      lastActive: {
        type: Date,
        default: Date.now,
        index: true,
      },
      lastMessage: {
        type: String,
        default: "",
      },
      address: {
        type: String,
        default: "",
        trim: true,
      },
      deliverySlot: {
        type: String,
        default: "",
        trim: true,
      },
      paymentMethod: {
        type: String,
        default: "",
        trim: true,
      },
      orders: [
        {
          orderId: { type: String, default: "" },
          orderNumber: { type: String, default: "" },
          total: { type: Number, default: 0 },
          items: [
            {
              id: Number,
              name: String,
              price: Number,
              quantity: Number,
            },
          ],
          deliveryAddress: { type: String, default: "" },
          deliverySlot: { type: String, default: "" },
          paymentMethod: { type: String, default: "" },
          paymentUrl: { type: String, default: "" },
          status: { type: String, default: "confirmed" },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      totalSpent: {
        type: Number,
        default: 0,
      },
      orderCount: {
        type: Number,
        default: 0,
      },
      lastOrderDate: {
        type: Date,
      },
      unreadCount: {
        type: Number,
        default: 0,
      },
      totalMessages: {
        type: Number,
        default: 0,
      },
      metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
    },
    {
      timestamps: true,
    },
  );

  customerSchema.index({ lastActive: -1 });

  module.exports =
    mongoose.models.Customer || mongoose.model("Customer", customerSchema);
}
