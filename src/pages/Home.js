import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();

  return (
    <div style={{ textAlign: "center", marginTop: "100px" }}>
      <h1>Vyber rozhranie</h1>
      <button onClick={() => navigate("/obsluha")}>Obsluha</button>
      <button onClick={() => navigate("/kuchyna")}>Kuchyňa</button>
    </div>
  );
}
