import { useEffect, useRef } from "react";
import { animate, type JSAnimation } from "animejs";

export function useSectionReveal() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = root.current;
    if (!host || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animations: JSAnimation[] = [];
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        animations.push(animate(entry.target, { opacity: [0, 1], y: [24, 0], duration: 800, ease: "outCubic" }));
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.08 });
    host.querySelectorAll("[data-reveal]").forEach(element => observer.observe(element));
    return () => { observer.disconnect(); animations.forEach(animation => animation.revert()); };
  }, []);
  return root;
}
