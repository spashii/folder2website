// Auto-generated OG image (1200x630) via Satori -> SVG -> PNG (resvg).
// Card mirrors the theme palette; set in the bundled Lexend.
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const el = (style, children) => ({ type: "div", props: { style: { display: "flex", ...style }, children } });

export async function makeOgPng({ title, tagline, regular, bold, bg, fg, accent }) {
  const tree = el(
    { flexDirection: "column", justifyContent: "center", width: "100%", height: "100%", padding: 96, background: bg, color: fg, fontFamily: "Lexend" },
    [
      el({ fontSize: 72, fontWeight: 700, letterSpacing: "-3px", lineHeight: 1.05 }, title),
      el({ fontSize: 34, marginTop: 30, lineHeight: 1.4, maxWidth: 920 }, tagline),
      el({ marginTop: "auto", width: 64, height: 8, borderRadius: 4, background: accent }, []),
    ]
  );
  const svg = await satori(tree, {
    width: 1200,
    height: 630,
    fonts: [
      { name: "Lexend", data: regular, weight: 400, style: "normal" },
      { name: "Lexend", data: bold, weight: 700, style: "normal" },
    ],
  });
  return new Resvg(svg, { background: bg }).render().asPng();
}
