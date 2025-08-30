import { Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Obsluha from "./pages/Obsluha";
import Kuchyna from "./pages/Kuchyna";
import Presety from "./pages/Presety";

import { ToastProvider } from "./ui/toast";

function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/index" element={<Index />} />
        <Route path="/obsluha" element={<Obsluha />} />
        <Route path="/kuchyna" element={<Kuchyna />} />
        <Route path="/presety" element={<Presety />} />
      </Routes>
    </ToastProvider>
  );
}

export default App;
