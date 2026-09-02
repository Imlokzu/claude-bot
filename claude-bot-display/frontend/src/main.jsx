import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from "./App";
import { AuthGate } from "./auth.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ClerkProvider afterSignOutUrl="/"><AuthGate><App /></AuthGate></ClerkProvider>
  </React.StrictMode>
);
