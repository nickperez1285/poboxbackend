const express = require("express");
const { admin, getFirestore } = require("../config/firebaseAdmin");
const { sendSMS, isSignalWireConfigured } = require("../lib/signalwireSms");
const {
  requireAuth,
  loadAuthContext,
  requireAdmin,
  requirePartnerAccount,
  requireApprovedPartner,
} = require("../middleware/firebaseAuth");

const router = express.Router();
const db = getFirestore();

/** True if the user has a saved preferred partner location (non-empty partner id). */
function userHasPreferredLocation(userData) {
  const pl = userData && userData.prefLocation;
  const id = pl && pl.id;
  if (typeof id === "string" && id.length > 0) return true;
  // Firestore may deserialize document IDs as DocumentReference in some paths
  if (
    id &&
    typeof id === "object" &&
    typeof id.path === "string" &&
    id.path.includes("partners/")
  ) {
    return true;
  }
  return false;
}

/** Normalize partner profile fields (camelCase or legacy snake_case). */
function partnerAddressFromPartnerDoc(partnerData) {
  const p = partnerData || {};
  return {
    businessName: p.businessName || p.business_name || "",
    streetAddress: p.streetAddress || p.street_address || "",
    city: p.city || "",
    state: p.state || "",
    zipCode: p.zipCode || p.zip_code || "",
  };
}

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
    subject,
    reply_to: replyTo,
  };

  if (html) {
    payload.html = html;
  }

  const response = await fetch(resendApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    console.error("Resend API error:", {
      status: response.status,
      errorBody,
      payload,
    });
    throw new Error(
      errorBody?.message ||
        errorBody?.error?.message ||
        `Resend API request failed with status ${response.status}`,
    );
  }
};

const htmlEmail = (body) =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);max-width:600px;width:100%"><tr><td style="background:#121212;padding:28px 32px;text-align:center"><img src="https://porchpobox.com/porchlogo.png" alt="Porch P.O. Box" style="height:56px;display:block;margin:0 auto" /></td></tr><tr><td style="padding:36px 32px;color:#222;font-size:15px;line-height:1.7">${body}</td></tr><tr><td style="background:#f8f8f8;border-top:1px solid #eee;padding:20px 32px;text-align:center"><img src="https://porchpobox.com/logo.png" alt="Porch P.O. Box" style="height:48px;display:block;margin:0 auto 12px" /><p style="margin:0 0 4px;font-size:13px;color:#888">Porch P.O. Box &mdash; Convenient Package Receiving</p><p style="margin:0;font-size:13px"><a href="mailto:contact@porchpobox.com" style="color:#d4af37;text-decoration:none">contact@porchpobox.com</a></p></td></tr></table></td></tr></table></body></html>`;

/** Helper to geocode a string address into {lat, lng} using Google Maps API. */
const geocodeAddress = async (address) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn("[Geocoding] Missing GOOGLE_MAPS_API_KEY. Skipping.");
    return null;
  }
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === "OK" && data.results && data.results.length > 0) {
      return data.results[0].geometry.location;
    }
    console.error(
      `[Geocoding] Failed for "${address}":`,
      data.status,
      data.error_message || "",
    );
  } catch (err) {
    console.error(`[Geocoding] Network error for "${address}":`, err.message);
  }
  return null;
};

router.get(
  "/search-customers",
  requireAuth,
  loadAuthContext,
  requireApprovedPartner,
  async (req, res) => {
    const { q } = req.query;
    const partnerId = req.auth.uid;
    if (!q || String(q).trim().length < 2) return res.json([]);

    try {
      const searchTerm = String(q).trim().toLowerCase();
      let userDocs = [];

      const emailMatch = await db
        .collection("users")
        .where("email", "==", searchTerm)
        .limit(1)
        .get();
      if (!emailMatch.empty) {
        userDocs = emailMatch.docs;
      } else {
        const namePrefix = String(q).trim();
        const nameMatch = await db
          .collection("users")
          .where("name", ">=", namePrefix)
          .where("name", "<=", namePrefix + "\uf8ff")
          .limit(15)
          .get();
        userDocs = nameMatch.docs;
      }

      const results = await Promise.all(
        userDocs.map(async (uDoc) => {
          const u = uDoc.data();
          const countSnap = await db
            .doc(`partners/${partnerId}/packageCounts/${uDoc.id}`)
            .get();
          const c = countSnap.exists ? countSnap.data() : {};

          return {
            id: uDoc.id,
            name: u.name || "",
            email: u.email || "",
            status: u.status || "inactive",
            phoneNumber: u.phoneNumber || "",
            streetAddress: u.streetAddress || "",
            city: u.city || "",
            state: u.state || "",
            zipCode: u.zipCode || "",
            packageCount: Number(c.count) || 0,
            totalReceived: Number(c.totalReceived) || Number(c.count) || 0,
            totalPickedUp: Number(c.totalPickedUp) || 0,
          };
        }),
      );

      return res.json(results);
    } catch (error) {
      console.error("[search-customers] Error:", error);
      return res.status(500).json({ message: error.message });
    }
  },
);

router.post(
  "/test-email",
  requireAuth,
  loadAuthContext,
  requireAdmin,
  async (req, res) => {
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
      `),
      });
      return res
        .status(200)
        .json({ success: true, message: `Test email sent to ${email}` });
    } catch (error) {
      console.error("Test email failed:", error);
      return res.status(500).json({ message: error.message });
    }
  },
);

router.post(
  "/test-sms",
  requireAuth,
  loadAuthContext,
  requireAdmin,
  async (req, res) => {
    const { phoneNumber, message } = req.body || {};
    if (!phoneNumber)
      return res.status(400).json({ message: "Missing phoneNumber" });

    console.log(`[SignalWire] Manual test trigger for ${phoneNumber}`);
    try {
      if (!isSignalWireConfigured()) {
        return res.status(500).json({
          message:
            "SignalWire is not configured. Set SIGNALWIRE_SPACE_URL, SIGNALWIRE_PROJECT_ID, SIGNALWIRE_API_TOKEN, and SIGNALWIRE_PHONE_NUMBER.",
        });
      }

      await sendSMS(
        phoneNumber,
        message || "Test message from Porch P.O. Box! 📦",
      );
      return res.status(200).json({
        success: true,
        message: `Test request processed. Check your server logs for results.`,
      });
    } catch (error) {
      console.error("Test SMS route crash:", error);
      return res.status(500).json({ message: error.message });
    }
  },
);

router.post(
  "/vendor-registration",
  requireAuth,
  loadAuthContext,
  requirePartnerAccount,
  async (req, res) => {
    const {
      businessName,
      email,
      phoneNumber,
      streetAddress,
      city,
      state,
      zipCode,
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
      return res
        .status(400)
        .json({ message: "Missing vendor registration fields" });
    }

    const tokenEmail = (req.auth.email || "").toLowerCase();
    if (tokenEmail !== String(email).toLowerCase()) {
      return res
        .status(403)
        .json({ message: "Email must match signed-in account" });
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
      `),
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
      `),
      });

      return res.status(200).json({ success: true });
    } catch (error) {
      return res
        .status(500)
        .json({ message: error.message || "Email delivery failed" });
    }
  },
);

router.post("/contact", async (req, res) => {
  const { name, email, message, subject } = req.body || {};

  if (!name || !email || !message) {
    return res.status(400).json({ message: "Missing contact form fields" });
  }

  try {
    await sendEmail({
      to: adminInbox,
      replyTo: email,
      subject: `New Contact Form Submission: ${subject || "General Inquiry"}`,
      html: htmlEmail(`
        <h2 style="margin:0 0 16px;color:#121212">New Contact Form Submission</h2>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px 12px;background:#f8f5ea;font-weight:bold;width:40%">Name</td><td style="padding:8px 12px;background:#fafafa">${name}</td></tr>
          <tr><td style="padding:8px 12px;background:#f8f5ea;font-weight:bold">Email</td><td style="padding:8px 12px;background:#fafafa">${email}</td></tr>
          <tr><td style="padding:8px 12px;background:#f8f5ea;font-weight:bold">Subject</td><td style="padding:8px 12px;background:#fafafa">${subject || "General Inquiry"}</td></tr>
        </table>
        <p><strong>Message:</strong></p>
        <div style="padding:16px;background:#f9f9f9;border-radius:8px;border:1px solid #eee;white-space:pre-wrap;color:#333">${message}</div>
      `),
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Contact email delivery failed" });
  }
});

router.post("/welcome", async (req, res) => {
  const { name, email } = req.body || {};

  if (!email) {
    return res.status(400).json({ message: "Missing email" });
  }

  try {
    await sendEmail({
      to: email,
      replyTo: adminInbox,
      subject: "Welcome to Porch P.O. Box",
      html: htmlEmail(`
        <h2 style="margin:0 0 16px;color:#121212">Welcome, ${name || "there"}!</h2>
        <p>Your Porch P.O. Box account has been created successfully.</p>
        <p>Your <strong>first package delivery is on us</strong> — no subscription needed to try the service.</p>
        <p>Ready to get unlimited access? View our plans and subscribe today:</p>
        <p style="text-align:center;margin:28px 0">
          <a href="https://porchpobox.com/plans" style="background:#d4af37;color:#121212;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;font-size:15px">View Plans</a>
        </p>
        <p style="color:#666;font-size:14px">Questions? Just reply to this email and we'll be happy to help.</p>
      `),
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Welcome email delivery failed" });
  }
});

router.post("/referral", async (req, res) => {
  const { email, referralCode, additionalInfo } = req.body || {};

  if (!email) {
    return res.status(400).json({ message: "Referral email is required" });
  }

  try {
    let referrerName = null;
    if (referralCode) {
      try {
        const referrerSnap = await db
          .collection("users")
          .where("referralCode", "==", referralCode.toUpperCase())
          .limit(1)
          .get();
        if (!referrerSnap.empty) {
          referrerName =
            referrerSnap.docs[0].data().name ||
            referrerSnap.docs[0].data().email ||
            null;
        }
      } catch (err) {
        console.error("Error looking up referral code:", err);
      }
    }

    await sendEmail({
      to: adminInbox,
      replyTo: email,
      subject: "New Porch P.O. Box Referral Submission",
      html: htmlEmail(`
        <h2 style="margin:0 0 16px;color:#121212">New Referral Submission</h2>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px 12px;background:#f8f5ea;font-weight:bold;width:40%">Referral Email</td><td style="padding:8px 12px;background:#fafafa">${email}</td></tr>
          <tr><td style="padding:8px 12px;background:#f8f5ea;font-weight:bold">Referral Code</td><td style="padding:8px 12px;background:#fafafa">${referralCode ? `<strong>${referralCode.toUpperCase()}</strong>${referrerName ? ` &mdash; submitted by <strong>${referrerName}</strong>` : " (code not matched to any user)"}` : "Not provided"}</td></tr>
          <tr><td style="padding:8px 12px;background:#f8f5ea;font-weight:bold">Additional Info</td><td style="padding:8px 12px;background:#fafafa">${additionalInfo || "None provided"}</td></tr>
        </table>
      `),
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Referral email delivery failed" });
  }
});

router.post(
  "/partner-approved",
  requireAuth,
  loadAuthContext,
  requireAdmin,
  async (req, res) => {
    const {
      businessName,
      email,
      streetAddress,
      city,
      state,
      zipCode,
      referredBy,
    } = req.body || {};

    if (!businessName || !email) {
      return res
        .status(400)
        .json({ message: "Missing partner approval email fields" });
    }

    try {
      // Find and update partner document with geocoded coordinates
      const partnerSnap = await db
        .collection("partners")
        .where("email", "==", email)
        .limit(1)
        .get();

      if (!partnerSnap.empty) {
        const partnerDoc = partnerSnap.docs[0];
        const fullAddress = `${streetAddress || ""}, ${city || ""}, ${state || ""} ${zipCode || ""}`;
        const coords = await geocodeAddress(fullAddress);

        const updateData = {
          approved: true,
          status: "active",
        };
        if (coords) {
          updateData.lat = coords.lat;
          updateData.lng = coords.lng;
        }
        await partnerDoc.ref.update(updateData);
      }

      // Send approval email to partner
      await sendEmail({
        to: email,
        replyTo: adminInbox,
        subject: "Welcome to Porch P.O. Box! Your Partner Account is Active 📦",
        html: htmlEmail(`
        <h2 style="margin:0 0 16px;color:#121212">Welcome to the Porch P.O. Box Network!</h2>
        <p>Hello <strong>${businessName}</strong>,</p>
        <p>We are excited to inform you that your application has been <strong>approved</strong> and your location is now <strong>active</strong> on the Porch P.O. Box network! Welcome to the community.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
        <h3 style="color:#d4af37;margin-bottom:12px">🚀 Getting Started</h3>
        <ul style="padding-left:20px;margin-bottom:24px">
          <li><strong>Verify Your Hours:</strong> Log in to the <a href="https://porchpobox.com/partner" style="color:#d4af37;text-decoration:none;font-weight:bold">Partner Portal</a> and ensure your store hours are accurate. This ensures customers know when they can pick up their packages.</li>
          <li><strong>Check-In Packages:</strong> When a package arrives for a Porch P.O. Box customer, use the "Package Check-In" tool on your dashboard. The customer will be automatically notified via email once you enter the quantity.</li>
          <li><strong>ID Verification:</strong> When a customer arrives for pickup, please verify their ID matches the name on the package before marking it as delivered in the system.</li>
          <li><strong>Manage Payouts:</strong> You can track your earnings and active subscriber counts directly from your "Partner Profile" page.</li>
        </ul>
        <p style="text-align:center;margin:32px 0">
          <a href="https://porchpobox.com/partner" style="background:#121212;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:bold;font-size:16px;box-shadow:0 4px 12px rgba(0,0,0,0.15)">Access Your Dashboard</a>
        </p>
        <p style="background:#fdf8e6;padding:16px;border-radius:8px;border:1px solid #f0c040;font-size:14px">
          <strong>Pro Tip:</strong> Most partners place a small sign or designated shelf in a secure area to keep Porch P.O. Box deliveries organized and separate from store inventory.
        </p>
        <p style="color:#666;font-size:14px;margin-top:24px">If you have any questions, simply reply to this email. We're here to help you succeed!</p>
      `),
      });

      // Handle referral reward if a referral code was used
      if (referredBy) {
        try {
          const referrerSnap = await db
            .collection("users")
            .where("referralCode", "==", referredBy)
            .limit(1)
            .get();
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
              subscriptionEndsAt:
                admin.firestore.Timestamp.fromDate(oneYearFromNow),
              referralRewardGranted: true,
              referralRewardGrantedAt:
                admin.firestore.FieldValue.serverTimestamp(),
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
              `),
              });
            }
          }
        } catch (referralErr) {
          console.error("Referral reward error:", referralErr.message);
        }
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      return res
        .status(500)
        .json({ message: error.message || "Partner approval email failed" });
    }
  },
);

router.post(
  "/package-check-in",
  requireAuth,
  loadAuthContext,
  requireApprovedPartner,
  async (req, res) => {
    const { vendorName, partnerId, recipients } = req.body || {};

    if (
      !vendorName ||
      !partnerId ||
      !Array.isArray(recipients) ||
      recipients.length === 0
    ) {
      return res
        .status(400)
        .json({ message: "Missing package check in recipients or partner ID" });
    }

    const invalidRecipient = recipients.find(
      (recipient) => !recipient?.id || !recipient?.packageCount,
    );
    if (invalidRecipient) {
      return res.status(400).json({
        message: "All package recipients must include id and packageCount",
      });
    }

    try {
      const partnerRef = db.doc(`partners/${partnerId}`);
      const partnerSnap = await partnerRef.get();
      const partnerData = partnerSnap.exists ? partnerSnap.data() : {};
      const now = Date.now();
      const TEN_MINUTES = 10 * 60 * 1000;

      const partnerPackageUpdates = recipients.map(async (recipient) => {
        const userRef = db.doc(`users/${recipient.id}`);
        const userSnap = await userRef.get();
        const userData = userSnap.exists ? userSnap.data() : {};
        const currentCheckedIn = Number(userData.packagesCheckedIn) || 0;

        const partnerPackageRef = db.doc(
          `partners/${partnerId}/packageCounts/${recipient.id}`,
        );
        const userPackageHistoryRef = db.doc(
          `users/${recipient.id}/packageHistory/${partnerId}`,
        );
        const packageCountSnap = await partnerPackageRef.get();
        const packageCountData = packageCountSnap.exists
          ? packageCountSnap.data()
          : {};
        const currentCount = Number(packageCountData.count) || 0;
        const currentTotalReceived =
          Number(packageCountData.totalReceived) || 0;
        const currentTotalPickedUp =
          Number(packageCountData.totalPickedUp) || 0;

        const userUpdates = {
          packagesCheckedIn: admin.firestore.FieldValue.increment(
            recipient.packageCount,
          ),
        };
        if (userData.status !== "active") {
          userUpdates.status = currentCheckedIn === 0 ? "trial" : "inactive";
        }

        // Default preferred location to this partner whenever the user has no valid pref saved.
        // (Previously required packagesCheckedIn === 0, which skipped users with stale counts or legacy data.)
        if (!userHasPreferredLocation(userData)) {
          const addr = partnerAddressFromPartnerDoc(partnerData);
          userUpdates.prefLocation = {
            id: String(partnerId),
            businessName: addr.businessName || vendorName || "Unknown Partner",
            streetAddress: addr.streetAddress,
            city: addr.city,
            state: addr.state,
            zipCode: addr.zipCode,
          };
          console.log(
            `[package-check-in] Set default prefLocation for user ${recipient.id} → partner ${partnerId}`,
          );
        }

        // Send email if notifications enabled. Dedup only applies if they've been emailed before — always send on first check-in.
        const lastEmailAt =
          packageCountData.lastCheckInEmailAt?.toMillis?.() || 0;
        const isFirstCheckIn =
          !packageCountData.lastCheckInEmailAt ||
          packageCountData.lastCheckInEmailAt === null;
        const shouldSendEmail =
          recipient.email &&
          userData.notificationsEnabled !== false &&
          (isFirstCheckIn || now - lastEmailAt > TEN_MINUTES);

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
            `),
            });
            console.log(`Check-in email sent to ${recipient.email}`);
          } catch (emailErr) {
            console.error(
              `Package email to ${recipient.email} failed:`,
              emailErr.message,
            );
          }
        } else if (!recipient.email) {
          console.warn(
            `Recipient ${recipient.id} has no email — skipping notification`,
          );
        } else {
          console.log(
            `Skipping duplicate check-in email for ${recipient.email} — sent within last 10 minutes`,
          );
        }

        // Send SMS alert if notifications are enabled and number exists
        const userPhone = userData.phoneNumber || recipient.phoneNumber;
        if (
          userPhone &&
          userData.notificationsEnabled !== false &&
          (isFirstCheckIn || now - lastEmailAt > TEN_MINUTES)
        ) {
          await sendSMS(
            userPhone,
            `📦 Porch P.O. Box: A package has arrived for you at ${vendorName}! Pick it up during store hours.`,
          );
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
              ...(shouldSendEmail
                ? {
                    lastCheckInEmailAt:
                      admin.firestore.FieldValue.serverTimestamp(),
                  }
                : {}),
            },
            { merge: true },
          ),
          userPackageHistoryRef.set(
            {
              partnerId,
              partnerName: vendorName || "Unknown Partner",
              totalReceived: currentTotalReceived + recipient.packageCount,
              totalPickedUp: currentTotalPickedUp,
              currentWaiting: currentCount + recipient.packageCount,
            },
            { merge: true },
          ),
          db.collection(`partners/${partnerId}/activityLog`).add({
            type: "check-in",
            customerId: recipient.id,
            customerName: recipient.name || "Unknown",
            customerEmail: recipient.email || "",
            packageCount: recipient.packageCount,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          }),
        ]);
      });

      await Promise.all(partnerPackageUpdates);
      await partnerRef.set(
        {
          packageCheckInCount: admin.firestore.FieldValue.increment(
            recipients.reduce((sum, r) => sum + r.packageCount, 0),
          ),
        },
        { merge: true },
      );

      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({
        message: error.message || "Package check in email delivery failed",
      });
    }
  },
);

router.post(
  "/package-delivery",
  requireAuth,
  loadAuthContext,
  requireApprovedPartner,
  async (req, res) => {
    const { partnerId, partnerName, recipients } = req.body || {};

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res
        .status(400)
        .json({ message: "Missing package delivery recipients" });
    }

    const invalidRecipient = recipients.find(
      (recipient) => !recipient?.id || !recipient?.packageCount,
    );
    if (invalidRecipient) {
      return res.status(400).json({
        message: "All delivery recipients must include id and packageCount",
      });
    }

    try {
      for (const recipient of recipients) {
        const userRef = db.doc(`users/${recipient.id}`);
        const userSnap = await userRef.get();
        const userData = userSnap.exists ? userSnap.data() : {};
        const currentDelivered = Number(userData.packagesDelivered) || 0;
        const updates = {
          packagesDelivered: admin.firestore.FieldValue.increment(
            recipient.packageCount,
          ),
        };

        if (userData.status !== "active" && currentDelivered === 0) {
          updates.status = "inactive";
        }

        const writes = [userRef.set(updates, { merge: true })];

        // Send delivery email to all non-active users on every delivery
        if (userData.status !== "active" && recipient.email) {
          const plansUrl = `${process.env.FRONTEND_URL || "https://porchpobox.com"}/plans`;
          const isFirstDelivery = currentDelivered === 0;
          writes.push(
            sendEmail({
              to: recipient.email,
              replyTo: adminInbox,
              subject: isFirstDelivery
                ? "Welcome to Porch P.O. Box \u2014 Your first delivery is complete!"
                : `Your package has been picked up at ${partnerName || "your Porch P.O. Box location"}`,
              html: htmlEmail(`
              <h2 style="margin:0 0 16px;color:#121212">${isFirstDelivery ? "Your First Delivery is Complete!" : "Package Picked Up!"}</h2>
              <p>Hello ${recipient.name || "there"},</p>
              ${
                isFirstDelivery
                  ? `<p>Your first package has been picked up &mdash; welcome to Porch P.O. Box!</p><p>We hope the experience was convenient. Subscribe to keep receiving packages:</p>`
                  : `<p>Your package has been picked up at <strong>${partnerName || "your Porch P.O. Box location"}</strong>. Subscribe to keep using the service:</p>`
              }
              <p style="text-align:center;margin:28px 0">
                <a href="${plansUrl}" style="background:#d4af37;color:#121212;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;font-size:15px">View Plans</a>
              </p>
              <p style="color:#666;font-size:14px">Questions? Just reply to this email and we'll be happy to help.</p>
            `),
            }),
          );
        }

        if (partnerId) {
          const partnerPackageRef = db.doc(
            `partners/${partnerId}/packageCounts/${recipient.id}`,
          );
          const userPackageHistoryRef = db.doc(
            `users/${recipient.id}/packageHistory/${partnerId}`,
          );
          const partnerPackageSnap = await partnerPackageRef.get();
          const partnerPackageData = partnerPackageSnap.exists
            ? partnerPackageSnap.data()
            : {};
          const currentCount = Number(partnerPackageData.count) || 0;
          const currentTotalReceived =
            Number(partnerPackageData.totalReceived) || 0;
          const currentTotalPickedUp =
            Number(partnerPackageData.totalPickedUp) || 0;
          const nextWaiting = Math.max(
            currentCount - recipient.packageCount,
            0,
          );

          writes.push(
            userPackageHistoryRef.set(
              {
                partnerId,
                partnerName:
                  partnerName || partnerPackageData.name || "Unknown Partner",
                totalPickedUp: currentTotalPickedUp + recipient.packageCount,
                currentWaiting: nextWaiting,
              },
              { merge: true },
            ),
            db.collection(`partners/${partnerId}/activityLog`).add({
              type: "delivery",
              customerId: recipient.id,
              customerName: recipient.name || "Unknown",
              customerEmail: recipient.email || "",
              packageCount: recipient.packageCount,
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
            }),
            partnerPackageRef.set(
              {
                count: nextWaiting,
                totalPickedUp: currentTotalPickedUp + recipient.packageCount,
                lastCheckInEmailAt: null,
                ...(nextWaiting <= 0 ? { holdForResubscribe: false } : {}),
              },
              { merge: true },
            ),
          );
        }

        await Promise.all(writes);
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      return res
        .status(500)
        .json({ message: error.message || "Package delivery update failed" });
    }
  },
);

router.post("/user-signup", requireAuth, async (req, res) => {
  const { name, email, authProvider } = req.body || {};
  if (!email) {
    return res.status(400).json({ message: "Missing email" });
  }

  const tokenEmail = (req.auth.email || "").toLowerCase();
  if (tokenEmail !== String(email).toLowerCase()) {
    return res
      .status(403)
      .json({ message: "Email must match signed-in account" });
  }

  try {
    await db.collection("activityLog").add({
      type: "signup",
      userName: name || "Unknown",
      userEmail: email,
      authProvider: authProvider || "email",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Failed to write signup log:", error);
    return res
      .status(500)
      .json({ message: error.message || "Failed to log signup" });
  }
});

module.exports = router;
