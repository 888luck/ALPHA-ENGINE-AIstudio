const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const app = initializeApp({ projectId: "alpha-engine-ai-studio" });
console.log(typeof getFirestore);
try {
  const db1 = getFirestore(app);
  console.log("db1 works");
  const db2 = getFirestore(app, "ai-studio-alphaengine-94d6c309-5a24-4eb3-b5fc-aed88e51a000");
  console.log("db2 works");
} catch(e) {
  console.error("error:", e);
}
