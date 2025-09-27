import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();

  useEffect(() => {
    const r = localStorage.getItem("activeRole");
    navigate(r === "kasa" ? "/kasa" : r === "kuchyna" ? "/kuchyna" : "/obsluha", { replace: true });
  }, [navigate]);

  return null;
}
