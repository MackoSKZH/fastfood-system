import { useRef, useState } from "react";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { useToast } from "../ui/toast";

function fileName(session) {
  const safe = String(session).replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "session";
  return `qr-objednavka-${safe}.png`;
}

export default function QrLinkModal({ session, onClose }) {
  const toast = useToast();
  const exportRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [copiedKiosk, setCopiedKiosk] = useState(false);
  const url = `${window.location.origin}/objednat/${encodeURIComponent(session)}`;
  const kioskUrl = `${window.location.origin}/kiosk/${encodeURIComponent(session)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Odkaz skopírovaný.");
    } catch {
      toast.warn("Odkaz sa nepodarilo skopírovať. Označ ho a skopíruj ručne.");
    }
  }

  function downloadPng() {
    const source = exportRef.current;
    if (!source) {
      toast.warn("QR sa nepodarilo pripraviť. Skús znova.");
      return;
    }
    const link = document.createElement("a");
    link.href = source.toDataURL("image/png");
    link.download = fileName(session);
    link.click();
    toast.success("PNG stiahnuté.");
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="qr-link-title">
      <div className="backdrop" onClick={onClose} />
      <div
        className="sheet k-panel"
        style={{ maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h3 id="qr-link-title" style={{ margin: 0 }}>QR objednávka</h3>
          <button type="button" className="k-btn" onClick={onClose}>Zavrieť</button>
        </div>
        <p className="k-help">
          Zákazník naskenuje kód. Objednávka ide do kuchyne a platí v hotovosti pri výdaji.
          Kód sa nemení. Ponuka je vždy tá aktuálna.
        </p>
        <div style={{ display: "grid", placeItems: "center", padding: "8px 0 12px" }}>
          <QRCodeSVG value={url} size={220} includeMargin />
        </div>
        <div
          aria-hidden="true"
          style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }}
        >
          <QRCodeCanvas ref={exportRef} value={url} size={1024} marginSize={4} />
        </div>
        <div className="k-help" style={{ wordBreak: "break-all" }}>{url}</div>
        <div className="k-row" style={{ marginTop: 12 }}>
          <button type="button" className="k-btn primary" onClick={downloadPng}>
            Stiahnuť PNG
          </button>
          <button type="button" className="k-btn" onClick={copy}>
            {copied ? "Skopírované" : "Kopírovať odkaz"}
          </button>
        </div>
        <p className="k-help" style={{ marginTop: 16 }}>
          Tablet vedľa kasy otvorí túto adresu a uloží ju do záložiek. Zákazník si tam vyberie objednávku a lístok sa vytlačí sám.
        </p>
        <div className="k-help" style={{ wordBreak: "break-all" }}>{kioskUrl}</div>
        <div className="k-row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="k-btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(kioskUrl);
                setCopiedKiosk(true);
                toast.success("Adresa kiosku skopírovaná.");
              } catch {
                toast.warn("Adresu sa nepodarilo skopírovať. Označ ju a skopíruj ručne.");
              }
            }}
          >
            {copiedKiosk ? "Skopírované" : "Kopírovať adresu kiosku"}
          </button>
        </div>
      </div>
    </div>
  );
}
