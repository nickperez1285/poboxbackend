const express = require("express");
const { admin, getFirestore } = require("../../config/firebaseAdmin");

const router = express.Router();
const db = getFirestore();

const resendApiUrl = "https://api.resend.com/emails";
const adminInbox = "contact@porchpobox.com";
const frontendUrl = process.env.FRONTEND_URL || "https://porchpobox.com";

const sendEmail = async ({ to, subject, text }) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM_EMAIL || process.env.SMTP_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("Missing email credentials");

  const response = await fetch(resendApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from, to, reply_to: adminInbox, subject, text })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(err?.message || `Resend error ${response.status}`);
  }
};

const buildReminderEmail = (name, daysLeft, endsDate, plansUrl) => {
  const urgency = daysLeft <= 3 ? "⚠️ Final Reminder" : "📅 Reminder";
  const subject = `${urgency}: Your Porch P.O. Box subscription expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`;
  const text = [
    `Hello ${name || "there"},`,
    "",
    `Your Porch P.O. Box subscription expires on ${endsDate} — that's ${daysLeft} day${daysLeft !== 1 ? "s" : ""} away.`,
    "",
    "To keep receiving packages without interruption, renew your subscription before it expires:",
    "",
    plansUrl,
    "",
    daysLeft <= 3
      ? "Once your subscription expires, partners will not be able to accept new packages for your account until you renew."
      : "Renewing early extends your current subscription — you won't lose any remaining days.",
    "",
    "— The Porch P.O. Box Team"
  ].join("\n");

  return { subject, text };
};

router.get("/renewal-reminders", async (req, res) => {
  // Verify this is called by Vercel cron (or manually by admin)
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const now = new Date();
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Get all active users
    const snapshot = await db.collection("users")
      .where("status", "==", "active")
      .get();

    const results = { sent: [], skipped: [], errors: [] };

    await Promise.all(snapshot.docs.map(async (doc) => {
      const user = { id: doc.id, ...doc.data() };
      if (!user.email || !user.subscriptionEndsAt) return;

      const endsAt = user.subscriptionEndsAt.toDate
        ? user.subscriptionEndsAt.toDate()
        : new Date(user.subscriptionEndsAt);

      const msLeft = endsAt.getTime() - now.getTime();
      const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

      // Only send at exactly 7 or 3 days remaining
      if (daysLeft !== 7 && daysLeft !== 3) {
        results.skipped.push({ id: user.id, daysLeft });
        return;
      }

      // Check if we already sent this reminder today (avoid duplicates on retries)
      const reminderKey = `reminder_${daysLeft}d_sent`;
      const lastSent = user[reminderKey]?.toDate ? user[reminderKey].toDate() : null;
      if (lastSent) {
        const hoursSince = (now - lastSent) / (1000 * 60 * 60);
        if (hoursSince < 20) {
          results.skipped.push({ id: user.id, reason: "already sent today" });
          return;
        }
      }

      const endsDate = endsAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      const { subject, text } = buildReminderEmail(user.name, daysLeft, endsDate, `${frontendUrl}/plans`);

      try {
        await sendEmail({ to: user.email, subject, text });
        // Mark reminder as sent
        await db.collection("users").doc(user.id).update({
          [reminderKey]: admin.firestore.FieldValue.serverTimestamp()
        });
        results.sent.push({ id: user.id, email: user.email, daysLeft });
        console.log(`Renewal reminder sent to ${user.email} (${daysLeft} days left)`);
      } catch (emailErr) {
        console.error(`Failed to send reminder to ${user.email}:`, emailErr.message);
        results.errors.push({ id: user.id, error: emailErr.message });
      }
    }));

    console.log(`Renewal reminders: ${results.sent.length} sent, ${results.skipped.length} skipped, ${results.errors.length} errors`);
    return res.status(200).json({ success: true, ...results });
  } catch (err) {
    console.error("Renewal reminder cron error:", err);
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
