/* eslint-disable @next/next/no-img-element */
import {
  FaApple,
  FaArrowRightLong,
  FaFacebookF,
  FaGooglePlay,
  FaInstagram,
  FaMobileScreenButton,
  FaRegCommentDots,
  FaRegNewspaper,
  FaWhatsapp,
  FaXTwitter,
  FaYoutube,
} from "react-icons/fa6";

const NBT_HOME_URL = "https://navbharattimes.indiatimes.com/";
// Same masthead asset the header uses (app/page.tsx), 366x149.
const NBT_LOGO_SRC = "/newsletter-assets/logo.jpeg";

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.nbt.reader";
const APP_STORE_URL = "https://apps.apple.com/in/app/navbharat-times-hindi-news/id656093141";

const SOCIAL_LINKS = {
  youtube: "https://www.youtube.com/channel/UCl8wUKzoUVzg7U6ky1ZR8hQ",
  x: "https://x.com/NavbharatTimes?lang=en",
  facebook: "https://www.facebook.com/navbharattimes/",
  instagram: "https://www.instagram.com/nbt_news/",
  // TODO: swap in the official NBT WhatsApp channel link once it is available.
  whatsapp: "https://www.whatsapp.com/channel/0029VaABWbW6mYPG1GXDSY3H",
};

const MANAGE_SUBSCRIPTION_URL = "#";
const UNSUBSCRIBE_URL = "";
// TODO: point this at the feedback flow once it exists (see openFeedback in app/page.tsx).
const FEEDBACK_URL = "#";

export default function Footer() {
  return (
    <footer className="nbt-footer" aria-label="NBT footer">
      {/* ---------- TOP: brand | app download | social ---------- */}
      <div className="nbt-footer-main">
        <section
          className="nbt-footer-brand"
          aria-label="&#2344;&#2357;&#2349;&#2366;&#2352;&#2340; &#2335;&#2366;&#2311;&#2350;&#2381;&#2360;"
        >
          <a
            href={NBT_HOME_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="nbt-footer-logo-link"
            aria-label="&#2344;&#2357;&#2349;&#2366;&#2352;&#2340; &#2335;&#2366;&#2311;&#2350;&#2381;&#2360;"
          >
            <img
              src={NBT_LOGO_SRC}
              alt="&#2344;&#2357;&#2349;&#2366;&#2352;&#2340; &#2335;&#2366;&#2311;&#2350;&#2381;&#2360;"
              className="nbt-footer-logo"
              width={366}
              height={149}
            />
          </a>
        </section>

        <section className="nbt-footer-download" aria-label="Download the NBT app">
          <h2>
            <FaMobileScreenButton className="nbt-footer-heading-icon" aria-hidden="true" />
            NBT ऐप डाउनलोड करें
          </h2>

          <p>
            ताज़ा खबरें, वीडियो, लाइव अपडेट और भी बहुत कुछ अब आपके मोबाइल पर।
            {/* <br /> */}
          </p>

          <svg className="nbt-svg-defs" aria-hidden="true" focusable="false">
            <defs>
              <linearGradient id="nbt-play-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#00a0ff" />
                <stop offset="34%" stopColor="#00e676" />
                <stop offset="67%" stopColor="#ffce00" />
                <stop offset="100%" stopColor="#ff3a44" />
              </linearGradient>
            </defs>
          </svg>

          <div className="nbt-store-buttons">
            <a
              href={PLAY_STORE_URL}
              target="https://play.google.com/store/apps/details?id=com.nbt.reader"
              rel="noopener noreferrer"
              className="nbt-store-button nbt-store-google"
              aria-label="Get it on Google Play"
            >
              <FaGooglePlay aria-hidden="true" />
              <span>
                <small>GET IT ON</small>
                Google Play
              </span>
            </a>

            <a
              href={APP_STORE_URL}
              target="https://apps.apple.com/in/app/navbharat-times-hindi-news/id656093141"
              rel="noopener noreferrer"
              className="nbt-store-button nbt-store-apple"
              aria-label="Download on the App Store"
            >
              <FaApple aria-hidden="true" />
              <span>
                <small>Download on the</small>
                App Store
              </span>
            </a>
          </div>
        </section>

        <section className="nbt-footer-follow" aria-label="Follow NBT">
          <h2>हमें फॉलो करें</h2>

          <div className="nbt-social-icons">
            <a
              href={SOCIAL_LINKS.youtube}
              target="https://www.youtube.com/channel/UCl8wUKzoUVzg7U6ky1ZR8hQ"
              rel="noopener noreferrer"
              className="nbt-social-youtube"
              aria-label="YouTube"
            >
              <FaYoutube aria-hidden="true" />
            </a>

            <a
              href={SOCIAL_LINKS.x}
              target="https://x.com/NavbharatTimes?lang=en"
              rel="noopener noreferrer"
              className="nbt-social-x"
              aria-label="X"
            >
              <FaXTwitter aria-hidden="true" />
            </a>

            <a
              href={SOCIAL_LINKS.facebook}
              target="https://www.facebook.com/navbharattimes/"
              rel="noopener noreferrer"
              className="nbt-social-facebook"
              aria-label="Facebook"
            >
              <FaFacebookF aria-hidden="true" />
            </a>

            <a
              href={SOCIAL_LINKS.instagram}
              target="https://www.instagram.com/nbt_news/"
              rel="noopener noreferrer"
              className="nbt-social-instagram"
              aria-label="Instagram"
            >
              <FaInstagram aria-hidden="true" />
            </a>

            <a
              href={SOCIAL_LINKS.whatsapp}
              target="https://www.whatsapp.com/channel/0029VaABWbW6mYPG1GXDSY3H"
              rel="noopener noreferrer"
              className="nbt-social-whatsapp"
              aria-label="WhatsApp"
            >
              <FaWhatsapp aria-hidden="true" />
            </a>
          </div>

          <p className="nbt-footer-handle">@NBT हिंदी</p>
        </section>
      </div>

      {/* ---------- BOTTOM: newsletter links | feedback ---------- */}
      <hr className="nbt-footer-rule" />

      <div className="nbt-footer-lower">
        <nav
          className="nbt-footer-links"
          aria-label="&#2344;&#2381;&#2351;&#2370;&#2332;&#2364;&#2354;&#2375;&#2335;&#2352; &#2354;&#2367;&#2306;&#2325;"
        >
          <a className="nbt-footer-newsletter" href={NBT_HOME_URL}>
            <FaRegNewspaper aria-hidden="true" />
            अन्य न्यूज़लेटर
          </a>

          <span className="nbt-footer-sep" aria-hidden="true" />

          <a className="nbt-footer-muted" href={MANAGE_SUBSCRIPTION_URL}>
            सब्सक्राइब करें
          </a>

          <span className="nbt-footer-sep" aria-hidden="true" />

          <a className="nbt-footer-muted" href={UNSUBSCRIBE_URL}>
            अनसब्सक्राइब करें
          </a>
        </nav>

        <a className="nbt-footer-feedback" href={FEEDBACK_URL}>
          <FaRegCommentDots className="nbt-footer-feedback-icon" aria-hidden="true" />
          <span>अपनी राय दें</span>
          <FaArrowRightLong className="nbt-footer-feedback-arrow" aria-hidden="true" />
        </a>
      </div>

      <p className="nbt-footer-copyright">
        &copy; 2026 Navbharat Times. &#2360;&#2352;&#2381;&#2357;&#2366;&#2343;&#2367;&#2325;&#2366;&#2352; &#2360;&#2369;&#2352;&#2325;&#2381;&#2359;&#2367;&#2340;&#2404;
      </p>
    </footer>
  );
}
