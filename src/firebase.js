import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
    storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

const required = {
    apiKey: "REACT_APP_FIREBASE_API_KEY",
    authDomain: "REACT_APP_FIREBASE_AUTH_DOMAIN",
    projectId: "REACT_APP_FIREBASE_PROJECT_ID",
    storageBucket: "REACT_APP_FIREBASE_STORAGE_BUCKET",
    messagingSenderId: "REACT_APP_FIREBASE_MESSAGING_SENDER_ID",
    appId: "REACT_APP_FIREBASE_APP_ID",
};
for (const [key, envName] of Object.entries(firebaseConfig)) {
    if (!firebaseConfig[key]) {
        throw new Error(`Missing env var ${envName}`);
    }
}

const app = initializeApp(firebaseConfig);

export const db = getDatabase(app);
export default app;