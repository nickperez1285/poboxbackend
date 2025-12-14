const express = require('express');
const dotenv = require('dotenv');
const checkoutRoutes = require('./routes/checkoutRoutes');
const customerRoutes = require('./routes/customerRoutes');
const priceRoutes = require('./routes/priceRoutes');
const couponRoutes = require('./routes/couponRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const productRoutes = require('./routes/productRoutes');

const authRoutes = require("./routes/auth");

const cors = require('cors');
const connectDB = require("./config/db");

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
//connect to mongodb

connectDB();




// app.use(cors({
//      origin: "http://localhost:3000",
//   credentials: true
// }));




app.use(cors({
     origin: process.env.FRONTEND_URL,
  credentials: true
}));


app.use('/api', customerRoutes);
app.use('/api', priceRoutes);
app.use('/api', subscriptionRoutes);
app.use('/api', webhookRoutes);
app.use('/api', checkoutRoutes);
app.use('/api', couponRoutes)
app.use('/api', productRoutes)
app.use("/api/auth", authRoutes);


// const PORT = process.env.PORT || 3001;
// app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


module.exports = app;
