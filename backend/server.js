const express = require("express");
const checkoutRoutes = require("./routes/checkoutRoutes");
const customerRoutes = require("./routes/customerRoutes");
const priceRoutes = require("./routes/priceRoutes");
const couponRoutes = require("./routes/couponRoutes");
const stripeConfigRoutes = require("./routes/stripeConfig");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
const productRoutes = require("./routes/productRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const debugRoutes = require("./routes/debugRoutes");
const {
  requireAuth,
  loadAuthContext,
  requireAdmin,
} = require("./middleware/firebaseAuth");
const renewalRemindersRoute = require("./routes/cron/renewalReminders");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { corsOptions } = require("./middleware/corsConfig");
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const app = express();

// Security headers
app.use(helmet());

// Apply CORS at the very top to ensure preflight requests
// are handled before any body parsing or route matching.
app.use(cors(corsOptions));

// Rate limiting for API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later" },
});
app.use("/api", apiLimiter);

app.post(
  "/api/webhook",
  express.raw({ type: "application/json" }),
  require("./routes/webhookRoutes"),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/notifications", notificationRoutes);
app.use("/api/debug", requireAuth, loadAuthContext, requireAdmin, debugRoutes);
app.use("/api/cron", renewalRemindersRoute);

app.use("/api", customerRoutes);
app.use("/api", priceRoutes);
app.use("/api", stripeConfigRoutes);
app.use("/api", subscriptionRoutes);
app.use("/api", checkoutRoutes);
app.use("/api", couponRoutes);
app.use("/api", productRoutes);

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

const PORT = process.env.PORT || 3001;

if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on ${PORT}`));
}

module.exports = app;
