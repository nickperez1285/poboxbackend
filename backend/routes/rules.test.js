const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const fs = require("fs");

describe("Firestore Security Rules", () => {
  let testEnv;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "porchpobox-test",
      firestore: {
        rules: fs.readFileSync("firestore.rules", "utf8"),
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  test("Users should be able to read their own profile", async () => {
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    const aliceProfile = aliceDb.collection("users").doc("alice");

    await testEnv.withSecurityRulesDisabled((db) => {
      return db.collection("users").doc("alice").set({ name: "Alice" });
    });

    await assertSucceeds(aliceProfile.get());
  });

  test("Users should NOT be able to read others' profiles", async () => {
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    const bobProfile = aliceDb.collection("users").doc("bob");

    await assertFails(bobProfile.get());
  });

  test("Unapproved partners should not be able to check in packages", async () => {
    const strangerDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      strangerDb.collection("partners").doc("any").set({ approved: true }),
    );
  });
});
