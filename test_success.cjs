const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const app = initializeApp({
  projectId: "alpha-engine-ai-studio",
  credential: applicationDefault()
});

const db = getFirestore(app, "ai-studio-alphaengine-94d6c309-5a24-4eb3-b5fc-aed88e51a000");

db.collection("system_config").limit(1).get()
  .then((snapshot) => {
    console.log("Firestore Admin SDK Access Success!");
    console.log("Documents found in system_config:", snapshot.size);
  })
  .catch(e => console.error("Firestore Admin SDK Error:", e));
