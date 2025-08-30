import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
    storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_FIREBASE_APP_ID,
  // databaseURL: process.env.REACT_APP_FIREBASE_DATABASE_URL,
};

// jednoduchá kontrola, nech to pri builde hneď spadne ak niečo chýba
for (const [k, v] of Object.entries(firebaseConfig)) {
    if (v === undefined) {
        throw new Error(`Missing env var for Firebase config: ${k}`);
    }
}

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
