const express = require("express");
const { admin, getFirestore } = require("../config/firebaseAdmin");

const router = express.Router();
const db = getFirestore();

const adminInbox = "contact@porchpobox.com";
const resendApiUrl = "https://api.resend.com/emails";

const sendEmail = async ({ to, replyTo, subject, html }) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM_EMAIL || process.env.SMTP_FROM_EMAIL;

  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY");
  }

  if (!from) {
    throw new Error("Missing MAIL_FROM_EMAIL or SMTP_FROM_EMAIL");
  }

  const payload = {
    from,
    to,
    reply_to: replyTo
  };

  if (html) {
    payload.html = html;
  }

  const response = await fetch(resendApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    console.error("Resend API error:", { status: response.status, errorBody, payload });
    throw new Error(
      errorBody?.message ||
        errorBody?.error?.message ||
        `Resend API request failed with status ${response.status}`
    );
  }
};

const htmlEmail = (body) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);max-width:600px;width:100%"><tr><td style="background:#121212;padding:28px 32px;text-align:center"><img src="https://porchpobox.com/porchlogo.png" alt="Porch P.O. Box" style="height:56px;display:block;margin:0 auto" /></td></tr><tr><td style="padding:36px 32px;color:#222;font-size:15px;line-height:1.7">${body}</td></tr><tr><td style="background:#f8f8f8;border-top:1px solid #eee;padding:20px 32px;text-align:center"><img src="https://porchpobox.com/logo.png" alt="Porch P.O. Box" style="height:48px;display:block;margin:0 auto 12px" /><p style="margin:0 0 4px;font-size:13px;color:#888">Porch P.O. Box &mdash; Convenient Package Receiving</p><p style="margin:0;font-size:13px"><a href="mailto:contact@porchpobox.com" style="color:#d4af37;text-decoration:none">contact@porchpobox.com</a></p></td></tr></table></td></tr></table></body></html>`;

router.post("/test-email", async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ message: "Missing email" });
  try {
    await sendEmail({
      to: email,
      replyTo: adminInbox,
      subject: "Porch P.O. Box — Email Test",
      html: htmlEmail(`
        <h2 style="margin:0 0 16px;color:#121212">Email Test</h2>
        <p>This is a test email from Porch P.O. Box. If you received this, email notifications are working correctly.</p>
      `)
    });
    return res.status(200).json({ success: true, message: `Test email sent to ${email}` });
  } catch (error) {
    console.error("Test email failed:", error);
    return res.status(500).json({ message: error.message });
  }
});

router.post("/vendor-registration", async (req, res) => {
  const {
    businessName,
    email,
    phoneNumber,
    streetAddress,
    city,
    state,
    zipCode
  } = req.body || {};

  if (
    !businessName ||
    !email ||
    !phoneNumber ||
    !streetAddress ||
    !city ||
    !state ||
    !zipCode
  ) {
    return res.status(400).json({ message: "Missing vendor registration fields" });
  }

  try {
    await sendEmail({
      to: adminInbox,
      replyTo: email,
      subject: `New Vendor Registration: ${businessName}`,
      html: htmlEmail(`
        <h2 style="margin:0 0 16px;color:#121212">New Vendor Registration</h2>
        <p>A new vendor has registered and is awaiting review.</p>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px 12px;background:#f8f5ea;font-weight:bold;width:40%">Business Name</td><td style="padding:8px 12px;background:#fafafa">${businessName}</td></tr>
          <tr><td style="padding:8px 12px;background:#f8f5ea;font-weight:bold">Email</td><td style="padding:8px 12px;background:#fafafa">${email}</td></tr>
          <tr><td style="padding:8px 12px;background:#f8f5ea;font-weight:bold">Phone</td><td style="padding:8px 12px;background:#fafafa">${phoneNumber}</td></tr>
          <tr><td style="padding:8px 12px;background:#f8f5ea;font-weight:bold">Address</td><td style="padding:8px 12px;background:#fafafa">${streetAddress}, ${city}, ${state} ${zipCode}</td></tr>
        </table>
        <p style="text-align:center;margin:28px 0">
          <a href="https://porchpobox.com/admin" style="background:#d4af37;color:#121212;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;font-size:15px">Review in Admin Portal</a>
        </p>
      `)
    });

    await sendEmail({
      to: email,
      replyTo: adminInbox,
      subject: "Porch P.O. Box — Vendor Request Received",
      html: htmlEmail(`
        <h2 style="margin:0 0 16px;color:#121212">Request Received, ${businessName}!</h2>
        <p>Thank you for applying to become a Porch P.O. Box vendor.</p>
        <p>Your registration has been received and is currently under review. We'll reach out once the review is complete.</p>
        <p style="color:#666;font-size:14px">Questions? Just reply to this email and we'll be happy to help.</p>
      `)
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Email delivery failed" });
  }
});

router.post("/referral", async (req, res) => {
  const { email, additionalInfo } = req.body || {};

  if (!email) {
    return res.status(400).json({ message: "Referral email is required" });
  }

  try {
    await sendEmail({
      to: adminInbox,
      replyTo: email,
      subject: "New Porch P.O. Box referral submission",
      html: htmlEmail(`
        <h2 style="margin:0 0 16px;color:#121212">New Referral Submission</h2>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px 12px;background:#f8f5ea;font-weight:bold;width:40%">Referral Email</td><td style="padding:8px 12px;background:#fafafa">${email}</td></tr>
          <tr><td style="padding:8px 12px;background:#f8f5ea;font-weight:bold">Additional Info</td><td style="padding:8px 12px;background:#fafafa">${additionalInfo || "None provided"}</td></tr>
        </table>
      `)
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Referral email delivery failed" });
  }
});

router.post("/partner-approved", async (req, res) => {
  const {
    businessName,
    email,
    streetAddress,
    city,
    state,
    zipCode,
    referredBy
  } = req.body || {};

  if (!businessName || !email) {
    return res.status(400).json({ message: "Missing partner approval email fields" });
  }

  try {
    // Send approval email to partner
    await sendEmail({
      to: email,
      replyTo: adminInbox,
      subject: "Your Porch P.O. Box Partner Request has been APPROVED!",
      html: htmlEmail(`
        <h2 style="margin:0 0 16px;color:#121212">You're Approved, ${businessName}!</h2>
        <p>Your request to become a Porch P.O. Box Partner has been <strong style="color:#1a7f37">approved</strong>. Welcome to the community!</p>
        <p>You can now sign in to the partner portal to manage package check-ins and deliveries.</p>
        <p style="text-align:center;margin:28px 0">
          <a href="https://porchpobox.com/partner" style="background:#d4af37;color:#121212;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;font-size:15px">Go to Partner Portal</a>
        </p>
        <p style="color:#666;font-size:14px">Questions? Just reply to this email and we'll be happy to help.</p>
      `)
    });

    // Handle referral reward if a referral code was used
    if (referredBy) {
      try {
        const referrerSnap = await db.collection("users").where("referralCode", "==", referredBy).limit(1).get();
        if (!referrerSnap.empty) {
          const referrerDoc = referrerSnap.docs[0];
          const referrer = referrerDoc.data();

          // Grant 1 year of free service
          const now = new Date();
          const oneYearFromNow = new Date(now);
          oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

          await referrerDoc.ref.update({
            status: "active",
            subscribedAt: admin.firestore.Timestamp.fromDate(now),
            subscriptionEndsAt: admin.firestore.Timestamp.fromDate(oneYearFromNow),
            referralRewardGranted: true,
            referralRewardGrantedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          // Send reward email to referrer
          if (referrer.email) {
            await sendEmail({
              to: referrer.email,
              replyTo: adminInbox,
              subject: "🎉 You've earned a FREE year of Porch P.O. Box!",
              html: htmlEmail(`
                <h2 style="margin:0 0 16px;color:#121212">You've Earned Free Service for a Year!</h2>
                <p>Hello ${referrer.name || "there"},</p>
                <p>Great news! The business you referred &mdash; <strong>${businessName}</strong> &mdash; has just been approved as a Porch P.O. Box partner.</p>
                <p>As a thank you for your referral, you've been awarded <strong style="color:#1a7f37">one full year of free Porch P.O. Box service</strong>!</p>
                <p>Your subscription is now active through <strong>${oneYearFromNow.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</strong>.</p>
                <p style="text-align:center;margin:28px 0">
                  <a href="https://porchpobox.com/profile" style="background:#d4af37;color:#121212;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;font-size:15px">View My Profile</a>
                </p>
                <p style="color:#666;font-size:14px">Thank you for helping grow the Porch P.O. Box community!</p>
              `)
            });
          }
        }
      } catch (referralErr) {
        console.error("Referral reward error:", referralErr.message);
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Partner approval email failed" });
  }
});

router.post("/package-check-in", async (req, res) => {
  const { vendorName, partnerId, recipients } = req.body || {};

  if (!vendorName || !partnerId || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ message: "Missing package check in recipients or partner ID" });
  }

  const invalidRecipient = recipients.find((recipient) => !recipient?.id || !recipient?.packageCount);
  if (invalidRecipient) {
    return res.status(400).json({ message: "All package recipients must include id and packageCount" });
  }

  try {
    const partnerRef = db.doc(`partners/${partnerId}`);
    const now = Date.now();
    const TEN_MINUTES = 10 * 60 * 1000;

    const partnerPackageUpdates = recipients.map(async (recipient) => {
      const userRef = db.doc(`users/${recipient.id}`);
      const userSnap = await userRef.get();
      const userData = userSnap.exists ? userSnap.data() : {};
      const currentCheckedIn = Number(userData.packagesCheckedIn) || 0;

      const partnerPackageRef = db.doc(`partners/${partnerId}/packageCounts/${recipient.id}`);
      const userPackageHistoryRef = db.doc(`users/${recipient.id}/packageHistory/${partnerId}`);
      const packageCountSnap = await partnerPackageRef.get();
      const packageCountData = packageCountSnap.exists ? packageCountSnap.data() : {};
      const currentCount = Number(packageCountData.count) || 0;
      const currentTotalReceived = Number(packageCountData.totalReceived) || 0;
      const currentTotalPickedUp = Number(packageCountData.totalPickedUp) || 0;

      const userUpdates = {
        packagesCheckedIn: admin.firestore.FieldValue.increment(recipient.packageCount)
      };
      if (userData.status !== "active") {
        userUpdates.status = currentCheckedIn === 0 ? "trial" : "inactive";
      }

      // Send email if notifications enabled. Dedup only applies if they've been emailed before — always send on first check-in.
      const lastEmailAt = packageCountData.lastCheckInEmailAt?.toMillis?.() || 0;
      const isFirstCheckIn = !packageCountData.lastCheckInEmailAt;
      const shouldSendEmail = recipient.email && userData.notificationsEnabled !== false && (isFirstCheckIn || (now - lastEmailAt > TEN_MINUTES));

      if (shouldSendEmail) {
        try {
          await sendEmail({
            to: recipient.email,
            replyTo: adminInbox,
            subject: `Package received at ${vendorName}`,
            html: htmlEmail(`
              <h2 style="margin:0 0 16px;color:#121212">Your Package Has Arrived!</h2>
              <p>Hello ${recipient.name || "there"},</p>
              <p>A package has been checked in for you at <strong>${vendorName}</strong>.</p>
              <p>You can pick it up at your convenience during store hours.</p>
              <p style="color:#666;font-size:14px">Questions? Just reply to this email and we'll be happy to help.</p>
            `)
          });
          console.log(`Check-in email sent to ${recipient.email}`);
        } catch (emailErr) {
          console.error(`Package email to ${recipient.email} failed:`, emailErr.message);
        }
      } else if (!recipient.email) {
        console.warn(`Recipient ${recipient.id} has no email — skipping notification`);
      } else {
        console.log(`Skipping duplicate check-in email for ${recipient.email} — sent within last 10 minutes`);
      }

      await Promise.all([
        userRef.set(userUpdates, { merge: true }),
        partnerPackageRef.set(
          {
            count: currentCount + recipient.packageCount,
            totalReceived: currentTotalReceived + recipient.packageCount,
            totalPickedUp: currentTotalPickedUp,
            name: recipient.name || "Unnamed user",
            email: recipient.email || "",
            ...(shouldSendEmail ? { lastCheckInEmailAt: admin.firestore.FieldValue.serverTimestamp() } : {})
          },
          { merge: true }
        ),
        userPackageHistoryRef.set(
          {
            partnerId,
            partnerName: vendorName || "Unknown Partner",
            totalReceived: currentTotalReceived + recipient.packageCount,
            totalPickedUp: currentTotalPickedUp,
            currentWaiting: currentCount + recipient.packageCount
          },
          { merge: true }
        ),
        db.collection(`partners/${partnerId}/activityLog`).add({
          type: "check-in",
          customerId: recipient.id,
          customerName: recipient.name || "Unknown",
          customerEmail: recipient.email || "",
          packageCount: recipient.packageCount,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        })
      ]);
    });

    await Promise.all(partnerPackageUpdates);
    await partnerRef.set(
      { packageCheckInCount: admin.firestore.FieldValue.increment(recipients.reduce((sum, r) => sum + r.packageCount, 0)) },
      { merge: true }
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Package check in email delivery failed" });
  }
});

router.post("/package-delivery", async (req, res) => {
  const { partnerId, partnerName, recipients } = req.body || {};

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ message: "Missing package delivery recipients" });
  }

  const invalidRecipient = recipients.find((recipient) => !recipient?.id || !recipient?.packageCount);
  if (invalidRecipient) {
    return res.status(400).json({ message: "All delivery recipients must include id and packageCount" });
  }

  try {
    for (const recipient of recipients) {
      const userRef = db.doc(`users/${recipient.id}`);
      const userSnap = await userRef.get();
      const userData = userSnap.exists ? userSnap.data() : {};
      const currentDelivered = Number(userData.packagesDelivered) || 0;
      const updates = {
        packagesDelivered: admin.firestore.FieldValue.increment(recipient.packageCount)
      };

      if (userData.status !== "active" && currentDelivered === 0) {
        updates.status = "inactive";
      }

      const writes = [userRef.set(updates, { merge: true })];

      // Send welcome + subscribe reminder on first ever pickup
      if (currentDelivered === 0 && userData.status !== "active" && recipient.email) {
        const plansUrl = `${process.env.FRONTEND_URL || "https://porchpobox.com"}/plans`;
          writes.push(
          sendEmail({
            to: recipient.email,
            replyTo: adminInbox,
            subject: "Welcome to Porch P.O. Box — Your first delivery is complete!",
            html: htmlEmail(`
              <h2 style="margin:0 0 16px;color:#121212">Your First Delivery is Complete!</h2>
              <p>Hello ${recipient.name || "there"},</p>
              <p>Your first package has been picked up &mdash; welcome to Porch P.O. Box!</p>
              <p>We hope the experience was convenient. If you'd like to keep using the service and receive future deliveries, subscribe to one of our plans:</p>
              <p style="text-align:center;margin:28px 0">
                <a href="${plansUrl}" style="background:#d4af37;color:#121212;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;font-size:15px">View Plans</a>
              </p>
              <p style="color:#666;font-size:14px">Questions? Just reply to this email and we'll be happy to help.</p>
            `)
          })
        );
      }

      if (partnerId) {
        const partnerPackageRef = db.doc(`partners/${partnerId}/packageCounts/${recipient.id}`);
        const userPackageHistoryRef = db.doc(`users/${recipient.id}/packageHistory/${partnerId}`);
        const partnerPackageSnap = await partnerPackageRef.get();
        const partnerPackageData = partnerPackageSnap.exists ? partnerPackageSnap.data() : {};
        const currentCount = Number(partnerPackageData.count) || 0;
        const currentTotalReceived = Number(partnerPackageData.totalReceived) || 0;
        const currentTotalPickedUp = Number(partnerPackageData.totalPickedUp) || 0;
        const nextWaiting = Math.max(currentCount - recipient.packageCount, 0);

        writes.push(
          userPackageHistoryRef.set(
            {
              partnerId,
              partnerName: partnerName || partnerPackageData.name || "Unknown Partner",
              totalReceived: currentTotalReceived + recipient.packageCount,
              totalPickedUp: currentTotalPickedUp + recipient.packageCount,
              currentWaiting: nextWaiting
            },
            { merge: true }
          ),
          db.collection(`partners/${partnerId}/activityLog`).add({
            type: "delivery",
            customerId: recipient.id,
            customerName: recipient.name || "Unknown",
            customerEmail: recipient.email || "",
            packageCount: recipient.packageCount,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          }),
          partnerPackageRef.set(
            {
              count: nextWaiting,
              totalReceived: currentTotalReceived + recipient.packageCount,
              totalPickedUp: currentTotalPickedUp + recipient.packageCount
            },
            { merge: true }
          )
        );
      }

      await Promise.all(writes);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Package delivery update failed" });
  }
});

router.post("/user-signup", async (req, res) => {
  const { name, email, authProvider } = req.body || {};
  if (!email) {
    return res.status(400).json({ message: "Missing email" });
  }
  try {
    await db.collection("activityLog").add({
      type: "signup",
      userName: name || "Unknown",
      userEmail: email,
      authProvider: authProvider || "email",
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Failed to write signup log:", error);
    return res.status(500).json({ message: error.message || "Failed to log signup" });
  }
});

module.exports = router;
