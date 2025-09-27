// App.js
import { Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import Obsluha from "./pages/Obsluha";
import Kasa from "./pages/Kasa";
import Kuchyna from "./pages/Kuchyna";
import Presety from "./pages/Presety";

import { ToastProvider } from "./ui/toast";

// NOVÉ: centrálna session
import { SessionProvider } from "./SessionProvider";
import SessionGate from "./SessionGate";
import SessionSelect from "./SessionSelect";

function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <Routes>
          <Route path="/session" element={<SessionSelect />} />

          <Route
            path="/"
            element={
              <SessionGate>
                <Index />
              </SessionGate>
            }
          />
          <Route
            path="/index"
            element={
              <SessionGate>
                <Index />
              </SessionGate>
            }
          />
          <Route
            path="/obsluha"
            element={
              <SessionGate>
                <Obsluha />
              </SessionGate>
            }
          />
          <Route
            path="/kasa"
            element={
              <SessionGate>
                <Kasa />
              </SessionGate>
            }
          />
          <Route
            path="/kuchyna"
            element={
              <SessionGate>
                <Kuchyna />
              </SessionGate>
            }
          />
          <Route
            path="/presety"
            element={
              <SessionGate>
                <Presety />
              </SessionGate>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </ToastProvider>
  );
}

export default App;
