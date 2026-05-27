const express = require("express");
const request = require("supertest");

jest.mock("../middleware/firebaseAuth", () => ({
  requireAuth: (req, res, next) => {
    req.authUid = req.headers["x-test-uid"] || "test-user";
    req.auth = { uid: req.authUid, email: req.headers["x-test-email"] || "test@example.com" };
    next();
  },
  loadAuthContext: (req, res, next) => {
    req.isAdmin = req.headers["x-test-admin"] === "true";
    next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }
    next();
  },
  requirePartnerAccount: (req, res, next) => next(),
  requireApprovedPartner: (req, res, next) => {
    const partnerId = req.body?.partnerId;
    if (!partnerId) {
      return res.status(400).json({ message: "Missing partnerId" });
    }
    if (!req.isAdmin && req.authUid !== partnerId) {
      return res.status(403).json({ message: "Cannot act on behalf of another partner" });
    }
    req.partnerId = partnerId;
    next();
  },
}));

const mockDocState = new Map();
const mockCollectionDocs = new Map();

const applyMerge = (existing, updates) => {
  const next = { ...(existing || {}) };
  Object.entries(updates).forEach(([key, value]) => {
    if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "__increment")) {
      next[key] = (Number(existing?.[key]) || 0) + value.__increment;
      return;
    }
    if (value && typeof value === "object" && value.__serverTimestamp) {
      next[key] = value;
      return;
    }
    next[key] = value;
  });
  return next;
};

jest.mock("../config/firebaseAdmin", () => {
  const admin = {
    firestore: {
      FieldValue: {
        increment: jest.fn((v) => ({ __increment: v })),
        serverTimestamp: jest.fn(() => ({ __serverTimestamp: true }))
      },
      Timestamp: {
        fromDate: jest.fn((d) => ({ toDate: () => d, toMillis: () => d.getTime() }))
      }
    }
  };

  const getFirestore = () => ({
    doc: (path) => ({
      async get() {
        const data = mockDocState.get(path);
        return { exists: data !== undefined, data: () => data };
      },
      async set(payload, options = {}) {
        const current = mockDocState.get(path);
        const next = options.merge ? applyMerge(current, payload) : payload;
        mockDocState.set(path, next);
      },
      async update(payload) {
        const current = mockDocState.get(path) || {};
        mockDocState.set(path, applyMerge(current, payload));
      },
      get ref() {
        return {
          async update(payload) {
            const current = mockDocState.get(path) || {};
            mockDocState.set(path, applyMerge(current, payload));
          }
        };
      }
    }),
    collection: (path) => ({
      async add(payload) {
        const existing = mockCollectionDocs.get(path) || [];
        existing.push(payload);
        mockCollectionDocs.set(path, existing);
      },
      where: (field, op, value) => ({
        limit: () => ({
          async get() {
            const allDocs = mockDocState;
            const matches = [];
            allDocs.forEach((data, docPath) => {
              if (docPath.startsWith(path.replace(/\/$/, "") + "/") && data?.[field] === value) {
                matches.push({
                  data: () => data,
                  ref: {
                    async update(updates) {
                      mockDocState.set(docPath, applyMerge(data, updates));
                    }
                  }
                });
              }
            });
            return { empty: matches.length === 0, docs: matches };
          }
        })
      })
    })
  });

  return {
    admin,
    getAuth: () => ({
      verifyIdToken: jest.fn(),
    }),
    getFirestore,
  };
});

const { admin } = require("../config/firebaseAdmin");
const notificationRoutes = require("../routes/notificationRoutes");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/notifications", notificationRoutes);
  return app;
};

const partnerRequest = (app) => ({
  post: (url) =>
    request(app).post(url).set("x-test-uid", "p1").set("x-test-email", "a@test.com"),
});

const adminRequest = (app) => ({
  post: (url) =>
    request(app)
      .post(url)
      .set("x-test-uid", "admin-1")
      .set("x-test-admin", "true")
      .set("x-test-email", "admin@porchpobox.com"),
});

beforeEach(() => {
  mockDocState.clear();
  mockCollectionDocs.clear();
  process.env.RESEND_API_KEY = "test-key";
  process.env.MAIL_FROM_EMAIL = "noreply@porchpobox.com";
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM_EMAIL;
});

// ─── Package Check-In ────────────────────────────────────────────────────────

describe("POST /package-check-in", () => {
  it("returns 400 if required fields are missing", async () => {
    const res = await partnerRequest(buildApp()).post("/api/notifications/package-check-in").send({});
    expect(res.status).toBe(400);
  });

  it("sets first-time inactive user to trial and sends email", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", status: "inactive", packagesCheckedIn: 0, notificationsEnabled: true });
    mockDocState.set("partners/p1", { packageCheckInCount: 0 });

    const res = await partnerRequest(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(res.status).toBe(200);
    expect(mockDocState.get("users/u1").status).toBe("trial");
    expect(mockDocState.get("users/u1").packagesCheckedIn).toBe(1);
    expect(mockDocState.get("partners/p1/packageCounts/u1").count).toBe(1);
    expect(mockDocState.get("partners/p1/packageCounts/u1").totalReceived).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockDocState.get("users/u1").prefLocation).toEqual({
      id: "p1",
      businessName: "Shop A",
      streetAddress: "",
      city: "",
      state: "",
      zipCode: ""
    });
  });

  it("sets prefLocation from partner document on first check-in when partner has address fields", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", status: "trial", packagesCheckedIn: 0, notificationsEnabled: true });
    mockDocState.set("partners/p1", {
      packageCheckInCount: 0,
      businessName: "Main St Market",
      streetAddress: "10 Main St",
      city: "Austin",
      state: "TX",
      zipCode: "78701"
    });

    await partnerRequest(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Fallback Name",
      partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(mockDocState.get("users/u1").prefLocation).toEqual({
      id: "p1",
      businessName: "Main St Market",
      streetAddress: "10 Main St",
      city: "Austin",
      state: "TX",
      zipCode: "78701"
    });
  });

  it("does not overwrite prefLocation when user already has a preferred partner", async () => {
    const existing = {
      id: "p-other",
      businessName: "Other Shop",
      streetAddress: "99 Oak",
      city: "Dallas",
      state: "TX",
      zipCode: "75001"
    };
    mockDocState.set("users/u1", {
      email: "a@test.com",
      status: "active",
      packagesCheckedIn: 0,
      notificationsEnabled: true,
      prefLocation: existing
    });
    mockDocState.set("partners/p1", { packageCheckInCount: 0, businessName: "This Partner" });

    await partnerRequest(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "This Partner",
      partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(mockDocState.get("users/u1").prefLocation).toEqual(existing);
  });

  it("sets prefLocation on first check-in when prefLocation has no partner id", async () => {
    mockDocState.set("users/u1", {
      email: "a@test.com",
      status: "trial",
      packagesCheckedIn: 0,
      notificationsEnabled: true,
      prefLocation: { businessName: "stale", streetAddress: "" }
    });
    mockDocState.set("partners/p1", { packageCheckInCount: 0, businessName: "Real Partner", streetAddress: "1 Rd", city: "X", state: "YY", zipCode: "00000" });

    await partnerRequest(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Real Partner",
      partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(mockDocState.get("users/u1").prefLocation.id).toBe("p1");
    expect(mockDocState.get("users/u1").prefLocation.businessName).toBe("Real Partner");
  });

  it("sets prefLocation when missing even if packagesCheckedIn was already > 0 (legacy / partial data)", async () => {
    mockDocState.set("users/u1", {
      email: "a@test.com",
      status: "trial",
      packagesCheckedIn: 2,
      notificationsEnabled: true
    });
    mockDocState.set("partners/p1", {
      packageCheckInCount: 0,
      business_name: "Snake Case Shop",
      street_address: "9 Elm St",
      city: "Dallas",
      state: "TX",
      zip_code: "75201"
    });

    await partnerRequest(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Snake Case Shop",
      partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(mockDocState.get("users/u1").prefLocation).toEqual({
      id: "p1",
      businessName: "Snake Case Shop",
      streetAddress: "9 Elm St",
      city: "Dallas",
      state: "TX",
      zipCode: "75201"
    });
  });

  it("does not change prefLocation on second package check-in", async () => {
    const afterFirst = {
      id: "p1",
      businessName: "Shop A",
      streetAddress: "",
      city: "",
      state: "",
      zipCode: ""
    };
    mockDocState.set("users/u1", {
      email: "a@test.com",
      status: "trial",
      packagesCheckedIn: 1,
      notificationsEnabled: true,
      prefLocation: afterFirst
    });
    mockDocState.set("partners/p2", { packageCheckInCount: 0, businessName: "Other Location" });

    await partnerRequest(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Other Location",
      partnerId: "p2",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(mockDocState.get("users/u1").prefLocation).toEqual(afterFirst);
  });

  it("sets already-trialed user to inactive on second check-in", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", status: "trial", packagesCheckedIn: 1, notificationsEnabled: true });
    mockDocState.set("partners/p1", { packageCheckInCount: 1 });

    const res = await partnerRequest(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(res.status).toBe(200);
    expect(mockDocState.get("users/u1").status).toBe("inactive");
  });

  it("does not change status for active users", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", status: "active", packagesCheckedIn: 5, notificationsEnabled: true });
    mockDocState.set("partners/p1", { packageCheckInCount: 5 });

    await partnerRequest(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 2 }]
    });

    expect(mockDocState.get("users/u1").status).toBe("active");
  });

  it("treats stale inactive users with future subscriptionEndsAt as active", async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    mockDocState.set("users/u1", {
      email: "a@test.com",
      status: "inactive",
      packagesCheckedIn: 5,
      notificationsEnabled: true,
      subscriptionEndsAt: admin.firestore.Timestamp.fromDate(future),
    });
    mockDocState.set("partners/p1", { packageCheckInCount: 5 });

    const res = await partnerRequest(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Mista Poom", email: "a@test.com", packageCount: 1 }]
    });

    expect(res.status).toBe(200);
    expect(mockDocState.get("users/u1").status).toBe("active");
    expect(mockDocState.get("partners/p1/packageCounts/u1").status).toBe("active");
  });

  it("skips email when notificationsEnabled is false", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", status: "active", packagesCheckedIn: 1, notificationsEnabled: false });
    mockDocState.set("partners/p1", { packageCheckInCount: 1 });

    await partnerRequest(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("always sends email on first check-in regardless of timing", async () => {
    // No lastCheckInEmailAt set — first time this user has been checked in
    mockDocState.set("users/u1", { email: "a@test.com", status: "trial", packagesCheckedIn: 0, notificationsEnabled: true });
    mockDocState.set("partners/p1/packageCounts/u1", { count: 0, totalReceived: 0, totalPickedUp: 0 }); // no lastCheckInEmailAt
    mockDocState.set("partners/p1", { packageCheckInCount: 0 });

    await partnerRequest(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("skips duplicate email sent within 10 minutes", async () => {
    const recentTimestamp = { toMillis: () => Date.now() - 2 * 60 * 1000 }; // 2 min ago
    mockDocState.set("users/u1", { email: "a@test.com", status: "active", packagesCheckedIn: 1, notificationsEnabled: true });
    mockDocState.set("partners/p1/packageCounts/u1", { count: 1, totalReceived: 1, totalPickedUp: 0, lastCheckInEmailAt: recentTimestamp });
    mockDocState.set("partners/p1", { packageCheckInCount: 1 });

    await partnerRequest(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends email again after 10 minutes have passed", async () => {
    const oldTimestamp = { toMillis: () => Date.now() - 15 * 60 * 1000 }; // 15 min ago
    mockDocState.set("users/u1", { email: "a@test.com", status: "active", packagesCheckedIn: 1, notificationsEnabled: true });
    mockDocState.set("partners/p1/packageCounts/u1", { count: 1, totalReceived: 1, totalPickedUp: 0, lastCheckInEmailAt: oldTimestamp });
    mockDocState.set("partners/p1", { packageCheckInCount: 1 });

    await partnerRequest(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }]
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("correctly increments totalReceived on each check-in", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", status: "active", packagesCheckedIn: 2, notificationsEnabled: true });
    mockDocState.set("partners/p1/packageCounts/u1", { count: 2, totalReceived: 2, totalPickedUp: 0 });
    mockDocState.set("partners/p1", { packageCheckInCount: 2 });

    await partnerRequest(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 3 }]
    });

    expect(mockDocState.get("partners/p1/packageCounts/u1").totalReceived).toBe(5);
    expect(mockDocState.get("partners/p1/packageCounts/u1").count).toBe(5);
  });

  it("handles multiple recipients in one call", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", status: "active", packagesCheckedIn: 1, notificationsEnabled: true });
    mockDocState.set("users/u2", { email: "b@test.com", status: "active", packagesCheckedIn: 1, notificationsEnabled: true });
    mockDocState.set("partners/p1", { packageCheckInCount: 0 });

    const res = await partnerRequest(buildApp()).post("/api/notifications/package-check-in").send({
      vendorName: "Shop A", partnerId: "p1",
      recipients: [
        { id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 },
        { id: "u2", name: "Bob", email: "b@test.com", packageCount: 2 }
      ]
    });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockDocState.get("partners/p1").packageCheckInCount).toBe(3);
  });
});

// ─── Package Delivery ─────────────────────────────────────────────────────────

describe("POST /package-delivery", () => {
  it("returns 400 if recipients are missing", async () => {
    const res = await partnerRequest(buildApp()).post("/api/notifications/package-delivery").send({});
    expect(res.status).toBe(400);
  });

  it("increments packagesDelivered and sets inactive on first delivery for non-active user", async () => {
    mockDocState.set("users/u1", { status: "trial", packagesDelivered: 0 });

    const res = await partnerRequest(buildApp()).post("/api/notifications/package-delivery").send({
      partnerId: "p1",
      recipients: [{ id: "u1", packageCount: 1 }],
    });

    expect(res.status).toBe(200);
    expect(mockDocState.get("users/u1").status).toBe("inactive");
    expect(mockDocState.get("users/u1").packagesDelivered).toBe(1);
  });

  it("decrements count on delivery so packages in stock is accurate", async () => {
    mockDocState.set("users/u1", { status: "active", packagesDelivered: 2 });
    mockDocState.set("partners/p1/packageCounts/u1", { count: 3, totalReceived: 3, totalPickedUp: 0 });

    await partnerRequest(buildApp()).post("/api/notifications/package-delivery").send({
      partnerId: "p1", partnerName: "Shop A",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 2 }]
    });

    expect(mockDocState.get("partners/p1/packageCounts/u1").count).toBe(1);
    expect(mockDocState.get("partners/p1/packageCounts/u1").totalPickedUp).toBe(2);
  });

  it("does not change status for active users on delivery", async () => {
    mockDocState.set("users/u1", { status: "active", packagesDelivered: 3 });

    await partnerRequest(buildApp()).post("/api/notifications/package-delivery").send({
      partnerId: "p1",
      recipients: [{ id: "u1", packageCount: 1 }],
    });

    expect(mockDocState.get("users/u1").status).toBe("active");
  });

  it("sends first-delivery welcome email for non-active users", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", name: "Alice", status: "trial", packagesDelivered: 0 });

    await partnerRequest(buildApp()).post("/api/notifications/package-delivery").send({
      partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }],
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.html).toContain("first package");
  });

  it("does not send welcome email on subsequent deliveries", async () => {
    mockDocState.set("users/u1", { email: "a@test.com", status: "active", packagesDelivered: 2 });

    await partnerRequest(buildApp()).post("/api/notifications/package-delivery").send({
      partnerId: "p1",
      recipients: [{ id: "u1", name: "Alice", email: "a@test.com", packageCount: 1 }],
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ─── Partner Approved ─────────────────────────────────────────────────────────

describe("POST /partner-approved", () => {
  it("returns 400 if businessName or email missing", async () => {
    const res = await adminRequest(buildApp()).post("/api/notifications/partner-approved").send({ businessName: "Shop" });
    expect(res.status).toBe(400);
  });

  it("sends approval email to partner", async () => {
    const res = await adminRequest(buildApp()).post("/api/notifications/partner-approved").send({
      businessName: "Shop A", email: "shop@test.com"
    });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.to).toBe("shop@test.com");
    expect(body.html).toContain("approved");
  });

  it("sends referral reward email and grants 1 year when referredBy matches a user", async () => {
    mockDocState.set("users/referrer-1", {
      email: "referrer@test.com",
      name: "Jane",
      referralCode: "JA120525",
      status: "inactive"
    });

    const res = await adminRequest(buildApp()).post("/api/notifications/partner-approved").send({
      businessName: "Shop A", email: "shop@test.com", referredBy: "JA120525"
    });

    expect(res.status).toBe(200);
    // 2 emails: partner approval + referrer reward
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const rewardBody = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(rewardBody.to).toBe("referrer@test.com");
    expect(rewardBody.html).toContain("free");

    const referrer = mockDocState.get("users/referrer-1");
    expect(referrer.status).toBe("active");
    expect(referrer.referralRewardGranted).toBe(true);
  });

  it("does not error if referredBy code does not match any user", async () => {
    const res = await adminRequest(buildApp()).post("/api/notifications/partner-approved").send({
      businessName: "Shop A", email: "shop@test.com", referredBy: "XX999999"
    });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1); // only partner email
  });
});

// ─── Vendor Registration ──────────────────────────────────────────────────────

describe("POST /vendor-registration", () => {
  it("returns 400 if any required field is missing", async () => {
    const res = await partnerRequest(buildApp()).post("/api/notifications/vendor-registration").send({
      businessName: "Shop A"
    });
    expect(res.status).toBe(400);
  });

  it("sends two emails: admin alert and partner confirmation", async () => {
    const res = await partnerRequest(buildApp()).post("/api/notifications/vendor-registration").send({
      businessName: "Shop A", email: "a@test.com", phoneNumber: "5551234567",
      streetAddress: "123 Main St", city: "Springfield", state: "CA", zipCode: "90210"
    });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const adminEmail = JSON.parse(global.fetch.mock.calls[0][1].body);
    const partnerEmail = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(adminEmail.to).toBe("contact@porchpobox.com");
    expect(partnerEmail.to).toBe("a@test.com");
  });
});

// ─── Referral ─────────────────────────────────────────────────────────────────

describe("POST /referral", () => {
  it("returns 400 if email is missing", async () => {
    const res = await request(buildApp()).post("/api/notifications/referral").send({});
    expect(res.status).toBe(400);
  });

  it("sends referral notification to admin", async () => {
    const res = await request(buildApp()).post("/api/notifications/referral").send({
      email: "referrer@test.com", additionalInfo: "Great local shop"
    });

    expect(res.status).toBe(200);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.to).toBe("contact@porchpobox.com");
    expect(body.html).toContain("referrer@test.com");
  });
});

// ─── Missing env vars ─────────────────────────────────────────────────────────

describe("email env var validation", () => {
  it("returns 500 if RESEND_API_KEY is missing on partner approval", async () => {
    delete process.env.RESEND_API_KEY;

    const res = await adminRequest(buildApp()).post("/api/notifications/partner-approved").send({
      businessName: "Shop A", email: "shop@test.com"
    });

    expect(res.status).toBe(500);
  });
});
