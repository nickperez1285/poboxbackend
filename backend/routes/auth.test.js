const { requireAuth, requireAdmin } = require("../../middleware/firebaseAuth");

describe("Auth Middleware", () => {
  let mockReq;
  let mockRes;
  let nextFunction;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFunction = jest.fn();
  });

  test("requireAuth should fail if no token is provided", async () => {
    await requireAuth(mockReq, mockRes, nextFunction);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      message: "Missing authorization token",
    });
  });

  test("requireAdmin should block non-admin users", () => {
    mockReq.isAdmin = false;
    requireAdmin(mockReq, mockRes, nextFunction);
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({
      message: "Admin access required",
    });
  });

  test("requireAdmin should allow admin users", () => {
    mockReq.isAdmin = true;
    requireAdmin(mockReq, mockRes, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });
});
