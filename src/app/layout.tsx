import type { Metadata } from "next";
import { Noto_Sans_Devanagari, Poppins } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

/**
 * The two families the newsletter design uses (src/Frontend/index.html loaded
 * them from fonts.googleapis.com). next/font self-hosts them instead, and
 * exposes them as the CSS variables globals.css reads via --font-newsletter.
 */
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

const notoSansDevanagari = Noto_Sans_Devanagari({
  variable: "--font-noto-devanagari",
  subsets: ["devanagari", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "NBT Newsletter",
  description: "नवभारत टाइम्स न्यूज़लेटर — आज की सबसे जरूरी खबरें।",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="hi"
      className={`${poppins.variable} ${notoSansDevanagari.variable}`}
    >
      <body>
        {/* Font Awesome — the design uses fa-* icons in the author line and
            poll options. React hoists this into <head>. */}
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"
          precedence="default"
        />
        {children}
         <Analytics />
      </body>
    </html>
  );
}
