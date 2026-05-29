const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { admin, getFirestore } = require("../config/firebaseAdmin");

async function backfillNameLower() {
  const db = getFirestore();
  const usersRef = db.collection("users");
  const snapshot = await usersRef.get();

  if (snapshot.empty) {
    console.log("No users found.");
    return;
  }

  let updated = 0;
  const batch = db.batch();
  let opCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data.nameLower && data.name) {
      batch.update(doc.ref, { nameLower: String(data.name).toLowerCase() });
      updated++;
      opCount++;

      if (opCount >= 500) {
        await batch.commit();
        console.log(`Committed batch (${updated} so far)`);
        opCount = 0;
      }
    }
  }

  if (opCount > 0) {
    await batch.commit();
  }

  console.log(`Done. Updated ${updated} users with nameLower.`);
  process.exit(0);
}

backfillNameLower().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
