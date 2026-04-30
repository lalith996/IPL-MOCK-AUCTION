import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "IPL 2026 Auction — Live AI bidding";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4f46e5 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Cricket ball decoration */}
        <div
          style={{
            position: "absolute",
            top: 40,
            right: 80,
            width: 120,
            height: 120,
            borderRadius: "50%",
            background: "radial-gradient(circle at 35% 35%, #dc2626, #7f1d1d)",
            opacity: 0.6,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 60,
            left: 60,
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: "radial-gradient(circle at 35% 35%, #dc2626, #7f1d1d)",
            opacity: 0.4,
            display: "flex",
          }}
        />

        {/* Main content */}
        <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 24 }}>
          <span style={{ fontSize: 80 }}>🏏</span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span
              style={{
                fontSize: 64,
                fontWeight: 800,
                color: "#ffffff",
                letterSpacing: "-2px",
                lineHeight: 1,
              }}
            >
              IPL 2026
            </span>
            <span
              style={{
                fontSize: 40,
                fontWeight: 600,
                color: "#a5b4fc",
                letterSpacing: "4px",
                lineHeight: 1.2,
              }}
            >
              AUCTION
            </span>
          </div>
        </div>

        <div
          style={{
            fontSize: 24,
            color: "#e0e7ff",
            opacity: 0.9,
            textAlign: "center",
            maxWidth: 700,
          }}
        >
          10 AI franchise agents · live bidding · real-time
        </div>

        {/* Team badges row */}
        <div
          style={{
            display: "flex",
            gap: 12,
            marginTop: 40,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {["MI", "CSK", "RCB", "DC", "KKR", "RR", "PBKS", "SRH", "LSG", "GT"].map((t) => (
            <div
              key={t}
              style={{
                padding: "6px 14px",
                borderRadius: 9999,
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "#fff",
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: "1px",
                display: "flex",
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
