import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "./SessionProvider";

export default function SessionGate({ children }) {
    const { sessionCode } = useSession();
    const location = useLocation();
    if (!sessionCode) {
        sessionStorage.setItem("postLoginPath", location.pathname + location.search);
        return <Navigate to="/session" replace />;
    }
    return children;
}
