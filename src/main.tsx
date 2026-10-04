import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initialize } from "./store";
import { startPersistence } from "./persistence";
import "./styles.css";
initialize()
  .then(() => {
    startPersistence();
    createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  })
  .catch((e) => {
    document.getElementById("root")!.textContent =
      `Could not load demonstration data: ${e.message}. Reload when the app is online.`;
  });
if ("serviceWorker" in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register("/sw.js").catch(() => {
    /* installation status shown by app */
  });
