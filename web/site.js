(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setupReveal() {
    const revealItems = Array.from(document.querySelectorAll(".reveal"));
    if (revealItems.length === 0) return;

    revealItems.forEach((el, i) => {
      el.style.transitionDelay = `${Math.min(i * 60, 240)}ms`;
    });

    if (reduceMotion || !("IntersectionObserver" in window)) {
      revealItems.forEach((el) => el.classList.add("reveal--visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("reveal--visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -5% 0px" }
    );

    revealItems.forEach((el) => observer.observe(el));
  }

  function setupCardTilt() {
    if (reduceMotion) return;
    const cards = document.querySelectorAll(".product-card, .review-card, .blog-item, .co-card, .owned-card");
    cards.forEach((card) => {
      card.addEventListener("mousemove", (e) => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `perspective(900px) rotateX(${(-y * 2.8).toFixed(2)}deg) rotateY(${(x * 2.8).toFixed(2)}deg) translateY(-3px)`;
      });

      card.addEventListener("mouseleave", () => {
        card.style.transform = "";
      });
    });
  }

  function setupButtonFloat() {
    if (reduceMotion) return;
    const buttons = document.querySelectorAll(".btn-login, .btn-discord, .btn-buy, .btn-primary, .btn-loader, .co-purchase");
    buttons.forEach((btn) => {
      btn.addEventListener("mouseenter", () => {
        btn.style.willChange = "transform";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.willChange = "auto";
      });
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    setupReveal();
    setupCardTilt();
    setupButtonFloat();
  });
})();
