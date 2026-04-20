const express = require("express");
const { admin, getFirestore } = require("../config/firebaseAdmin");

const router = express.Router();
const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;

router.post("/activate-user", async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, message: "userId is required" });
  }

  try {
    const firestore = getFirestore();
    const userRef = firestore.collection("users").doc(userId);
    const purchaseDate = new Date();
    const endDate = new Date(purchaseDate.getTime() + THIRTY_DAYS_IN_MS);

    await userRef.set(
      {
        status: "active",
        subscribedAt: admin.firestore.Timestamp.fromDate(purchaseDate),
        subscriptionEndsAt: admin.firestore.Timestamp.fromDate(endDate),
        debugActivatedAt: admin.firestore.Timestamp.fromDate(new Date())
      },
      { merge: true }
    );

    res.json({
      success: true,
      userId,
      subscribedAt: purchaseDate.toISOString(),
      subscriptionEndsAt: endDate.toISOString()
    });
  } catch (error) {
    console.error("Debug activation error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
