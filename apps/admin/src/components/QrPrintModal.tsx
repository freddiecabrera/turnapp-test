import { QRCodeCanvas } from "qrcode.react";
import type { QrCode } from "@turnapp/shared";

export function QrPrintModal({ codes, onClose }: { codes: QrCode[]; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide print-modal" onClick={(e) => e.stopPropagation()}>
        <div className="no-print" style={{ display: "flex", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{codes.length} codes</h2>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" onClick={() => window.print()}>
              Print
            </button>
            <button className="btn secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="print-area qr-print-grid">
          {codes.map((c) => (
            <div key={c.id} className="qr-cell">
              <QRCodeCanvas value={c.code} size={120} includeMargin />
              <div className="qr-cell-name">{c.cardName}</div>
              <div className="qr-cell-code">{c.code}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
