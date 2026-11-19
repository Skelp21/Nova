import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initIntegrations } from "./lib/integrations";
import { useLibrary } from "./store/library";
import { bindEngine } from "./store/player";
import { initSync } from "./store/account";
import { applyPlatformClass } from "./lib/platform";
import "./styles/app.css";

bindEngine();
initIntegrations();
applyPlatformClass();
useLibrary.getState().load().then(initSync);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
