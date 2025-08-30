// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDkhMAbeidGClFhHHzy9DvjP6gLN5YlnDY",
    authDomain: "fastfood-system.firebaseapp.com",
    projectId: "fastfood-system",
    storageBucket: "fastfood-system.firebasestorage.app",
    messagingSenderId: "110445839744",
    appId: "1:110445839744:web:2d2a406cb06ed65ac5ad65"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);