let mongoose;
try {
  mongoose = require("mongoose");
} catch (e) {
  mongoose = null;
}

if (!mongoose) {
  module.exports = null;
} else {
  const messageSchema = new mongoose.Schema(
    {
      id: {
        type: String,
        required: true,
        unique: true,
        index: true,
      },
      phone: {
        type: String,
        required: true,
        index: true,
      },
      customerName: {
        type: String,
        default: "",
      },
      sender: {
        type: String,
        enum: ["customer", "agent"],
        required: true,
      },
      isAI: {
        type: Boolean,
        default: false,
      },
      text: {
        type: String,
        default: "",
      },
      timestamp: {
        type: Date,
        default: Date.now,
        index: true,
      },
      status: {
        type: String,
        default: "received",
      },
      rawPayload: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
      },
    },
    {
      timestamps: true,
    },
  );

  messageSchema.index({ phone: 1, timestamp: 1 });
  messageSchema.index({ timestamp: -1 });

  module.exports =
    mongoose.models.Message || mongoose.model("Message", messageSchema);
}
