const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const app = initializeApp({ projectId: "alpha-engine-ai-studio" });
getFirestore(app).collection("system_risk_state").limit(1).get().then(() => console.log("Success")).catch(e => console.error("Error:", e.message));
