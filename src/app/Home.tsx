"use client";

import { useEffect, useState } from "react";
import {
  FaInstagram,
  FaFacebookF,
  FaXTwitter,
  FaYoutube,
  FaWhatsapp,
} from "react-icons/fa6";

type Newsletter = {
  id: number;
  category: string;
  title: string;
  description: string;
  image: string;
  badgeClass: string;
};

const newsletters: Newsletter[] = [
  {
    id: 1,
    category: "Top News",
    title: "आज की बड़ी खबरें",
    description:
      "देश और दुनिया की सबसे महत्वपूर्ण खबरें, सीधे आपके इनबॉक्स में।",
    image:
      "https://images.unsplash.com/photo-1524492412937-b28074a5d7da?auto=format&fit=crop&w=900&q=80",
    badgeClass: "bg-[#e51c23]",
  },
  {
    id: 2,
    category: "Business",
    title: "बिजनेस & शेयर बाजार",
    description:
      "बाजार, नौकरी, टैक्स, स्कीम और आपके पैसे से जुड़ी जरूरी खबरें।",
    image:
      "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=900&q=80",
    badgeClass: "bg-[#269b57]",
  },
  {
    id: 3,
    category: "Sports",
    title: "खेल जगत",
    description:
      "क्रिकेट से लेकर ओलंपिक तक, हर बड़े मुकाबले और अपडेट सबसे पहले।",
    image:
      "https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=900&q=80",
    badgeClass: "bg-[#1976d2]",
  },
  {
    id: 4,
    category: "Bollywood",
    title: "बॉलीवुड & मनोरंजन",
    description: "फिल्म, सीरियल और एंटरटेनमेंट की दुनिया की हर बड़ी खबर।",
    image:
      "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=900&q=80",
    badgeClass: "bg-[#8744bd]",
  },
  {
    id: 5,
    category: "Astro",
    title: "राशिफल & ज्योतिष",
    description: "आज का राशिफल, ग्रह-नक्षत्र और जीवन से जुड़ी खास जानकारियां।",
    image:
      "https://images.unsplash.com/photo-1532968961962-8a0cb3a2d9e4?auto=format&fit=crop&w=900&q=80",
    badgeClass: "bg-[#f28c18]",
  },
  {
    id: 6,
    category: "Tech",
    title: "टेक & नवाचार",
    description: "AI, गैजेट्स, टेक्नोलॉजी और भविष्य की दुनिया से जुड़ी खबरें।",
    image:
      "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80",
    badgeClass: "bg-[#15959a]",
  },
  {
    id: 7,
    category: "Health",
    title: "हेल्थ & लाइफस्टाइल",
    description: "स्वास्थ्य, फिटनेस, खानपान और बेहतर जीवन के लिए जरूरी टिप्स।",
    image:
      "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=900&q=80",
    badgeClass: "bg-[#ed4c91]",
  },
  {
    id: 8,
    category: "Environment",
    title: "पर्यावरण & जीवन",
    description: "प्लानेट, प्रकृति और टिकाऊ भविष्य से जुड़ी अहम खबरें।",
    image:
      "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=900&q=80",
    badgeClass: "bg-[#419447]",
  },
];

/* Filter options come straight from the cards above, so a new newsletter
   shows up in the filter bar without anything else changing. */
const categories: string[] = [
  "All",
  ...Array.from(new Set(newsletters.map((newsletter) => newsletter.category))),
];

export default function Home() {
  const [subscribed, setSubscribed] = useState<number[]>([]);

  /* Which category the cards below are limited to. "All" shows everything. */
  const [activeCategory, setActiveCategory] = useState<string>("All");

  /* Presentation-only state for the subscribe popup. The newsletter held here
     is just the one whose name the card shows; nothing about subscribing is
     decided by it. */
  const [popupNewsletter, setPopupNewsletter] = useState<Newsletter | null>(
    null,
  );
  const [popupEmail, setPopupEmail] = useState("");

  /* The address each card was subscribed with. The cards themselves carry no
     email, so this is what /api/unsubscribe is given to look the row up by. */
  const [subscribedEmails, setSubscribedEmails] = useState<
    Record<number, string>
  >({});

  const visibleNewsletters =
    activeCategory === "All"
      ? newsletters
      : newsletters.filter(
          (newsletter) => newsletter.category === activeCategory,
        );

  const handleSubscribe = (id: number) => {
    setSubscribed((current) =>
      current.includes(id) ? current : [...current, id],
    );
  };

  const handleUnsubscribe = (id: number) => {
    setSubscribed((current) => current.filter((item) => item !== id));

    const email = subscribedEmails[id];
    if (!email) return;

    setSubscribedEmails((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

    const category = newsletters.find((item) => item.id === id)?.category;

    void fetch("/api/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, category }),
    }).catch((error) => console.error("Unsubscribe failed", error));
  };

  /* Escape closes the popup, and the page behind it stops scrolling while it
     is open — both are behaviour of the popup itself, nothing else. */
  useEffect(() => {
    if (!popupNewsletter) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopupNewsletter(null);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [popupNewsletter]);

  return (
    <main className="min-h-screen bg-white text-[#171717]">
      {/* =========================================================
          HEADER
      ========================================================= */}
      <header className="border-b border-[#eeeeee] bg-white">
        <div className="mx-auto flex min-h-[100px] max-w-[1400px] flex-col items-center justify-between gap-4 px-4 py-5 sm:px-6 md:flex-row md:gap-6 md:py-0 lg:px-12">
          {/* NBT LOGO */}
          <div className="flex items-center justify-center md:w-1/3 md:justify-start">
            <img
              src="https://static.langimg.com/thumb/119164302/navbharat-times.jpg?width=366&resizemode=4"
              alt="Navbharat Times"
              className="h-auto w-[105px] object-contain sm:w-[125px]"
            />
          </div>

          {/* CENTER HEADING */}
          <div className="flex flex-col items-center justify-center md:w-1/3">
            <h1 className="font-sans text-[28px] font-bold leading-none tracking-tight text-[#171717] sm:text-[34px] lg:text-[38px]">
              न्यूज़लेटर
            </h1>

            <div className="mt-3 h-[3px] w-[65px] bg-[#e21b23]" />
          </div>

          {/* RIGHT TAGLINE */}
          <div className="flex justify-center md:w-1/3 md:justify-end">
            <p className="text-center text-[14px] font-medium text-[#555555] sm:text-[15px] md:text-right">
              आपकी पसंद, आपकी खबरें
            </p>
          </div>
        </div>
      </header>

      {/* =========================================================
          HERO
      ========================================================= */}
      <section className="overflow-hidden bg-[#faf7f2]">
        <div className="mx-auto flex min-h-[265px] max-w-[1400px] items-center px-4 py-10 sm:px-6 lg:px-12 lg:py-0">
          {/* LEFT HERO CONTENT */}
          <div className="flex w-full items-center lg:w-[58%]">
            {/* ENVELOPE ICON */}
            <div className="mr-7 hidden shrink-0 sm:block">
              <div className="flex h-[82px] w-[82px] items-center justify-center rounded-xl">
                <div className="relative">
                  <div className="flex h-[58px] w-[70px] items-center justify-center rounded-lg border-[4px] border-[#e21b23] bg-white">
                    <div className="h-[15px] w-[21px] rounded-sm bg-[#e21b23]" />
                  </div>

                  <div className="absolute left-0 top-[-4px] h-[35px] w-[35px] rotate-45 border-l-[4px] border-t-[4px] border-[#e21b23]" />
                </div>
              </div>
            </div>

            <div className="min-w-0">
              <h2 className="break-words text-[28px] font-bold leading-[1.2] tracking-tight sm:text-[36px] md:text-[42px] lg:text-[44px]">
                खबरें, बिल्कुल
                <br />
                <span className=" mt-3 block text-[#e21b23]">आपकी पसंद की</span>
              </h2>

              <p className="mt-4 max-w-[600px] break-words text-[15px] leading-[1.65] text-[#3d4650] sm:text-[17px]">
                NBT के खास न्यूज़लेटर, जो आपकी रुचि, जरूरत
                <br className="hidden sm:block" />
                और जिंदगी के हिसाब से तैयार किए गए हैं।
              </p>
            </div>
          </div>

          {/* RIGHT HERO IMAGE */}
          <div className="hidden w-[42%] items-center justify-end lg:flex">
            <div className="relative h-[260px] w-full max-w-[520px] overflow-hidden">
              <img
                src="https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1200&q=80"
                alt="Newspaper"
                className="h-full w-full object-cover opacity-90"
              />

              {/* subtle overlay */}
              <div className="absolute inset-0 bg-gradient-to-l from-transparent via-transparent to-[#faf7f2]" />
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================
          NEWSLETTER CARDS
      ========================================================= */}
      <section className="bg-white px-4 py-10 sm:px-6 lg:px-12 lg:py-12">
        <div className="mx-auto max-w-[1400px]">
          {/* FILTER BAR */}
          <div className="mb-7 flex flex-wrap items-center gap-2 sm:gap-3">
            {categories.map((category) => {
              const isActive = category === activeCategory;

              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  aria-pressed={isActive}
                  className={`rounded-full border px-[16px] py-[8px] text-[14px] font-semibold transition-colors sm:text-[15px] ${
                    isActive
                      ? "border-[#e21b23] bg-[#e21b23] text-white"
                      : "border-[#e0e0e0] bg-white text-[#3d4650] hover:border-[#e21b23] hover:text-[#e21b23]"
                  }`}
                >
                  {category}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleNewsletters.map((newsletter) => {
              const isSubscribed = subscribed.includes(newsletter.id);

              return (
                <article
                  key={newsletter.id}
                  className="flex min-h-[430px] flex-col overflow-hidden rounded-[6px] border border-[#e5e5e5] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-shadow duration-200 hover:shadow-[0_5px_18px_rgba(0,0,0,0.09)]"
                >
                  {/* CARD IMAGE */}
                  <div className="h-[155px] w-full shrink-0 overflow-hidden">
                    <img
                      src={newsletter.image}
                      alt={newsletter.title}
                      className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.03]"
                    />
                  </div>

                  {/* CARD CONTENT */}
                  <div className="flex flex-1 flex-col p-[14px]">
                    {/* CATEGORY */}
                    <div className="mb-3">
                      <span
                        className={`inline-flex rounded-[6px] px-[12px] py-[6px] text-[14px] font-semibold text-white ${newsletter.badgeClass}`}
                      >
                        {newsletter.category}
                      </span>
                    </div>

                    {/* TITLE */}
                    <h3 className="break-words text-[19px] font-bold leading-[1.35] text-[#181818] sm:text-[21px]">
                      {newsletter.title}
                    </h3>

                    {/* DESCRIPTION */}
                    <p className="mt-2 break-words text-[14px] leading-[1.6] text-[#5c6167] sm:text-[15px]">
                      {newsletter.description}
                    </p>

                    {/* BUTTONS */}
                    <div className="mt-auto pt-5">
                      {/* SUBSCRIBE */}
                      <button
                        onClick={() => {
                          setPopupEmail("");
                          setPopupNewsletter(newsletter);
                        }}
                        className={`w-full rounded-[5px] py-[11px] text-[15px] font-semibold transition-all ${
                          isSubscribed
                            ? "bg-[#b7191f] text-white"
                            : "bg-[#e21b23] text-white hover:bg-[#c9181e]"
                        }`}
                      >
                        {isSubscribed ? "Subscribed" : "Subscribe"}
                      </button>

                      {/* UNSUBSCRIBE */}
                      <button
                        onClick={() => handleUnsubscribe(newsletter.id)}
                        disabled={!isSubscribed}
                        className={`mt-3 w-full rounded-[5px] border py-[10px] text-[15px] font-medium transition-all ${
                          isSubscribed
                            ? "border-[#d5d5d5] bg-white text-[#333333] hover:bg-[#f7f7f7]"
                            : "cursor-default border-[#e3e3e3] bg-white text-[#999999]"
                        }`}
                      >
                        Unsubscribe
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* =========================================================
          FOOTER
      ========================================================= */}
      <footer className="mt-2 bg-[#f5f6f7] px-4 py-8 sm:px-6 lg:px-12">
        <div className="mx-auto max-w-[1400px]">
          {/* TOP FOOTER */}
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            {/* FOOTER LOGO */}
            <div>
              <a
                href="https://navbharattimes.indiatimes.com/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Navbharat Times"
              >
                <img
                  src="https://static.langimg.com/thumb/119164302/navbharat-times.jpg?width=366&resizemode=4"
                  alt="Navbharat Times"
                  className="w-[105px]"
                />
              </a>
            </div>

            {/* LINKS */}
            <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[14px] text-[#444444]">
              <a href="https://navbharattimes.indiatimes.com/aboutus.cms" className="transition-colors hover:text-[#e21b23]">
                About Us
              </a>

              <span className="text-[#aaaaaa]">|</span>

              <a href="https://navbharattimes.indiatimes.com/privacypolicy.cms" className="transition-colors hover:text-[#e21b23]">
                Privacy Policy
              </a>

              <span className="text-[#aaaaaa]">|</span>

              <a href="#" className="transition-colors hover:text-[#e21b23]">
                Contact Us
              </a>
            </nav>

            {/* SOCIAL ICONS */}
            <div className="flex items-center gap-3">
              <a
                href="https://www.instagram.com/nbt_news/"
                aria-label="Instagram"
                className="flex h-8 w-8 shrink-0 items-center justify-center"
              >
                <FaInstagram size={18} color="#E4405F" />
              </a>

              <a
                href="https://www.facebook.com/navbharattimes/"
                aria-label="Facebook"
                className="flex h-8 w-8 shrink-0 items-center justify-center"
              >
                <FaFacebookF size={17} color="#1877F2" />
              </a>

              <a
                href="https://x.com/NavbharatTimes?lang=en"
                aria-label="X"
                className="flex h-8 w-8 shrink-0 items-center justify-center"
              >
                <FaXTwitter size={17} color="#000000" />
              </a>

              <a
                href="https://www.youtube.com/channel/UCl8wUKzoUVzg7U6ky1ZR8hQ"
                aria-label="YouTube"
                className="flex h-8 w-8 shrink-0 items-center justify-center"
              >
                <FaYoutube size={20} color="#FF0000" />
              </a>

              <a
                href="https://www.whatsapp.com/channel/0029VaABWbW6mYPG1GXDSY3H"
                aria-label="WhatsApp"
                className="flex h-8 w-8 shrink-0 items-center justify-center"
              >
                <FaWhatsapp size={19} color="#25D366" />
              </a>
            </div>
          </div>

          {/* DIVIDER */}
          <div className="my-6 h-px bg-[#d9dadd]" />

          {/* COPYRIGHT */}
          <div className="break-words text-center text-[13px] text-[#555b62]">
            © 2026 Navbharat Times. All rights reserved.
          </div>
        </div>
      </footer>

      {/* =========================================================
          SUBSCRIBE POPUP  (presentation only — holds the address in
          local state and closes; no request is made from here)
      ========================================================= */}
      {popupNewsletter && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4 sm:p-6"
          onClick={() => setPopupNewsletter(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="subscribe-popup-title"
            onClick={(event) => event.stopPropagation()}
            className="relative my-auto w-full max-w-[560px] rounded-[16px] bg-white p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)] sm:p-8"
          >
            {/* CLOSE */}
            <button
              type="button"
              aria-label="Close"
              onClick={() => setPopupNewsletter(null)}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-[22px] leading-none text-[#8a9099] transition-colors hover:bg-[#f2f2f2] hover:text-[#333333]"
            >
              ×
            </button>

            {/* HEADING */}
            <h2
              id="subscribe-popup-title"
              className="break-words pr-8 text-[22px] font-bold leading-[1.3] tracking-tight text-[#181818] sm:text-[26px]"
            >
              सब्सक्राइब करें
            </h2>

            <p className="mt-2 break-words text-[14px] leading-[1.6] text-[#5c6167] sm:text-[15px]">
              <span className="font-semibold text-[#181818]">
                {popupNewsletter.title}
              </span>{" "}
              न्यूज़लेटर सीधे अपने इनबॉक्स में पाने के लिए ईमेल दर्ज करें।
            </p>

            {/* SUBSCRIPTION BAR */}
            <form
              onSubmit={async (event) => {
                event.preventDefault();

                const email = popupEmail.trim();
                if (!email) return;

                const { id, category } = popupNewsletter;

                try {
                  const response = await fetch("/api/subscribe", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, category }),
                  });
                  if (!response.ok) throw new Error(String(response.status));
                } catch (error) {
                  /* Nothing was stored, so the card stays unsubscribed and the
                     popup stays open for another try. */
                  console.error("Subscribe failed", error);
                  return;
                }

                handleSubscribe(id);
                setSubscribedEmails((current) => ({ ...current, [id]: email }));
                setPopupNewsletter(null);
              }}
              className="mt-6"
            >
              <div className="flex w-full flex-col gap-3 rounded-[16px] border border-[#e3e3e3] bg-white p-[6px] shadow-[0_2px_10px_rgba(0,0,0,0.06)] sm:flex-row sm:items-center sm:gap-2 sm:rounded-full">
                {/* EMAIL FIELD */}
                <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2">
                  {/* ENVELOPE ICON */}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="h-5 w-5 shrink-0 text-[#8a9099]"
                  >
                    <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
                    <path d="m3.2 6.6 8.8 6.3 8.8-6.3" />
                  </svg>

                  <input
                    type="email"
                    value={popupEmail}
                    onChange={(event) => setPopupEmail(event.target.value)}
                    placeholder="अपना ईमेल दर्ज करें"
                    autoComplete="email"
                    className="w-full min-w-0 bg-transparent text-[15px] text-[#181818] outline-none placeholder:text-[#9aa0a6]"
                  />
                </div>

                {/* SUBSCRIBE BUTTON */}
                <button
                  type="submit"
                  className="flex w-full shrink-0 items-center justify-center gap-2 rounded-full bg-[#e21b23] px-6 py-[13px] text-[15px] font-bold text-white transition-colors hover:bg-[#c9181e] sm:w-auto"
                >
                  सब्सक्राइब करें
                  <span aria-hidden="true" className="text-[17px] leading-none">
                    →
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
