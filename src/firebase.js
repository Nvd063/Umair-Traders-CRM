import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
const firebaseConfig = {
  apiKey: "AIzaSyDR_SxHCt2uMb_mgvhkjWIl5UwtAa_VZ58",
  authDomain: "umair-traders-crm.firebaseapp.com",
  projectId: "umair-traders-crm",
  storageBucket: "umair-traders-crm.firebasestorage.app",
  messagingSenderId: "1051097984417",
  appId: "1:1051097984417:web:eb118fcff67f7d13b4efe0"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);


export const configured = !!(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);
export const auth = configured ? getAuth(initializeApp(firebaseConfig)) : null;
export const db = configured ? getFirestore(auth.app) : null;
