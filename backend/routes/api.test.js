const request = require("supertest");
const express = require("express");

jest.mock("../config/firebaseAdmin", () => ({
  admin: {
    firestore: {
      Timestamp: {
        fromDate: jest.fn((date) => ({ toDate: () => date })),
      },
    },
  },
  getFirestore: () => ({
    collection: jest.fn(),
    doc: jest.fn(),
  }),
}));

// Mock the middleware and firebase-admin to simulate auth failures
jest.mock("../middleware/firebaseAuth", () => ({
  requireAuth: (req, res, next) => {
    if (req.headers["x-test-auth"]) return next();
    return res.status(401).json({ message: "Missing authorization token" });
  },
  loadAuthContext: (req, res, next) => next(),
  requireAdmin: (req, res, next) =>
    res.status(403).json({ message: "Admin access required" }),
  requirePartnerAccount: (req, res, next) => next(),
  requireApprovedPartner: (req, res, next) => next(),
}));

const notificationRoutes = require("./notificationRoutes");

// Setup a mock app to test the routes
const app = express();
app.use(express.json());
app.use("/api/notifications", notificationRoutes);

describe("API Protected Routes Auth Failures", () => {
  describe("General Protected Routes", () => {
    test("POST /api/notifications/test-email should return 401 when unauthenticated", async () => {
      const response = await request(app)
        .post("/api/notifications/test-email")
        .send({ email: "test@example.com" });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe("Missing authorization token");
    });
  });

  describe("Admin Routes", () => {
    test("POST /api/notifications/partner-approved should return 403 when not an admin", async () => {
      // Note: We bypass requireAuth here in the mock but catch at requireAdmin
      const response = await request(app)
        .post("/api/notifications/partner-approved")
        .set("x-test-auth", "non-admin")
        .send({ businessName: "Test Store", email: "store@test.com" });

      expect(response.status).toBe(403);
      expect(response.body.message).toBe("Admin access required");
    });
  });

  describe("Vendor Routes", () => {
    test("POST /api/notifications/vendor-registration should return 401 if token is invalid", async () => {
      const response = await request(app)
        .post("/api/notifications/vendor-registration")
        .send({ businessName: "New Vendor" });

      expect(response.status).toBe(401);
    });
  });
});
