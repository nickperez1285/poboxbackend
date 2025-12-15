const express = require('express');
const checkoutRoutes = require('./routes/checkoutRoutes');
const customerRoutes = require('./routes/customerRoutes');
const priceRoutes = require('./routes/priceRoutes');
const couponRoutes = require('./routes/couponRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
// const webhookRoutes = require('./routes/webhookRoutes');
const productRoutes = require('./routes/productRoutes');
const authRoutes = require("./routes/auth");
const cors = require('cors');
const connectDB = require("./config/db");
// removed for vercel 
// const dotenv = require('dotenv');
// dotenv.config();

const app = express();




app.post(
  "/api/webhook",
  express.raw({ type: "application/json" }),
  require("./routes/webhookRoutes")
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));





// app.use(
//   cors({
//     origin: [
//       "http://localhost:3000",
//       process.env.BASE_URL
//     ],
//     credentials: true,
//   })
// );


app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // allow webhooks
      callback(null, true);
    },
    credentials: true,
  })
);
//connect to mongodb

const startServer = async () => {
  await connectDB();

  app.use("/api", customerRoutes);
  app.use("/api", priceRoutes);
  app.use("/api", subscriptionRoutes);
  app.use("/api", checkoutRoutes);
  app.use("/api", couponRoutes);
  app.use("/api", productRoutes);
  app.use("/api/auth", authRoutes);
};

startServer();

const PORT = process.env.PORT || 3001;

if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on ${PORT}`));
}

module.exports = app;
