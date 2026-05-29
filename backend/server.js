const express = require("express");
const checkoutRoutes = require("./routes/checkoutRoutes");
const customerRoutes = require("./routes/customerRoutes");
const priceRoutes = require("./routes/priceRoutes");
const couponRoutes = require("./routes/couponRoutes");
const stripeConfigRoutes = require("./routes/stripeConfig");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
// const webhookRoutes = require('./routes/webhookRoutes');
const productRoutes = require("./routes/productRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const authRoutes = require("./routes/auth");
const debugRoutes = require("./routes/debugRoutes");
const {
  requireAuth,
  loadAuthContext,
  requireAdmin,
} = require("./middleware/firebaseAuth");
const renewalRemindersRoute = require("./routes/cron/renewalReminders");
const cors = require("cors");
const { corsOptions } = require("./middleware/corsConfig");
// removed for vercel
// const dotenv = require('dotenv');
// dotenv.config();

const app = express();

// Apply CORS at the very top to ensure preflight requests
// are handled before any body parsing or route matching.
app.use(cors(corsOptions));

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
app.use("/api/auth", require("./routes/auth"));

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});
app.post("/api/auth/login", (req, res) => {
  res.status(200).json({ debug: "route hit" });
});

const PORT = process.env.PORT || 3001;

if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on ${PORT}`));
}

module.exports = app;
