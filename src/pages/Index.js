import { useNavigate } from "react-router-dom";

export default function Index() {
    const navigate = useNavigate();

    return (
        <div style={{ padding: 20 }}>
        <h1>Vyber svoju rolu</h1>
        <div style={{ display: "flex", gap: 12 }}>
            <button onClick={() => navigate("/obsluha")}>🧑‍💼 Obsluha</button>
            <button onClick={() => navigate("/kuchyna")}>👨‍🍳 Kuchyňa</button>
        </div>
        </div>
    );
}
