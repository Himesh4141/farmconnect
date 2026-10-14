import { GoogleReturn } from './components/GoogleSignIn';
import ConnectionStatus from './components/ConnectionStatus';
import './mobile.css';
import DeliveryPortal from './components/DeliveryPortal';
import ErrorBoundary from './components/ErrorBoundary';
import './commerce.css';
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import "./profiles.css";
import "./shopping.css";
import App from "./App";
import "./phone.css";
import FarmerPortal from "./components/FarmerPortal";
const Root = /^\/delivery(?:\/|$)/.test(window.location.pathname) ? DeliveryPortal : /^\/farmer(?:\/|$)/.test(window.location.pathname) ? FarmerPortal : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary><GoogleReturn /><ConnectionStatus /><Root /></ErrorBoundary>
  </StrictMode>,
);
