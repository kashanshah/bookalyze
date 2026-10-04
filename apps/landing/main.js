// Bookalyze landing page behaviour: scroll reveal, sticky-nav border and the waitlist form.

/*
 * WAITLIST: paste a form endpoint here to collect sign-ups, e.g. a free Formspree form
 * ("https://formspree.io/f/xxxxxxx"), Tally, Getform or your own API. Until it's set,
 * the form opens the visitor's email app addressed to WAITLIST_EMAIL instead.
 */
const WAITLIST_ENDPOINT = "";
const WAITLIST_EMAIL = "hello@bookalyze.com";

document.documentElement.classList.add("js");

const year = document.querySelector("[data-year]");
if (year) year.textContent = String(new Date().getFullYear());

// Staggered bar animation in the product preview.
document.querySelectorAll(".bars i").forEach((bar, i) => {
  bar.style.setProperty("--i", String(i));
});

// Reveal sections as they scroll into view.
const reveal = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        reveal.unobserve(entry.target);
      }
    }
  },
  { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
);
document.querySelectorAll(".reveal").forEach((el, i) => {
  el.style.transitionDelay = `${Math.min(i % 6, 5) * 60}ms`;
  reveal.observe(el);
});

// Border under the nav once the page scrolls.
const nav = document.querySelector(".nav");
const onScroll = () => nav?.classList.toggle("scrolled", window.scrollY > 8);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Waitlist forms.
for (const form of document.querySelectorAll("[data-form]")) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = form.querySelector("[data-status]");
    const button = form.querySelector("button");
    const email = new FormData(form).get("email")?.toString().trim() ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      status.textContent = "Please enter a valid email address.";
      status.className = "form-note err";
      return;
    }

    if (!WAITLIST_ENDPOINT) {
      const subject = encodeURIComponent("Bookalyze waitlist");
      const body = encodeURIComponent(`Please add me to the Bookalyze waitlist: ${email}`);
      window.location.href = `mailto:${WAITLIST_EMAIL}?subject=${subject}&body=${body}`;
      status.textContent = "Your email app should open. Just press send.";
      status.className = "form-note ok";
      return;
    }

    button.disabled = true;
    button.textContent = "Joining…";
    try {
      const res = await fetch(WAITLIST_ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: form.id || "landing" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      form.classList.add("done");
      status.textContent = "You're on the list. We'll email you when your spot opens.";
      status.className = "form-note ok";
    } catch {
      button.disabled = false;
      button.textContent = "Join the waitlist";
      status.textContent = "Something went wrong. Please try again in a moment.";
      status.className = "form-note err";
    }
  });
}
