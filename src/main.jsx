import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ClerkProvider } from '@clerk/clerk-react'

// Import your publishable key
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

const clerkAppearance = {
  elements: {
    footer: "hidden",
    footerAction: "hidden",
    footerActionLink: "hidden",
    cardFooter: "hidden",
    userButtonPopoverFooter: "hidden",
    userProfileFooter: "hidden",
    badge: "hidden",
    badgeText: "hidden",
    badgeIcon: "hidden",
    developmentModeBadge: "hidden"
  }
}

const installClerkBrandingHider = () => {
  if (typeof window === 'undefined') return;

  const shouldHideByText = (text) => {
    const t = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return t === 'secured by' || t === 'secured by clerk' || t === 'development mode';
  };

  const hideClosest = (el) => {
    if (!(el instanceof Element)) return;
    const container = el.closest('[class*="cl-"]') || el.parentElement || el;
    container.style.setProperty('display', 'none', 'important');
  };

  const scan = (root) => {
    if (!(root instanceof Element)) return;

    // Hide Clerk branding links + their immediate wrappers.
    root.querySelectorAll('a[href*="clerk.com"], a[href*="clerk.dev"]').forEach((a) => hideClosest(a));

    // Hide the "Secured by" and "Development mode" labels even if they're not links.
    root.querySelectorAll('span, p, div, a').forEach((el) => {
      const txt = el.textContent;
      if (!txt) return;
      if (shouldHideByText(txt)) hideClosest(el);
    });
  };

  const run = () => scan(document.body);
  run();

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        scan(node);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
};

if (!PUBLISHABLE_KEY) {
  throw new Error("Missing Publishable Key")
}

installClerkBrandingHider();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/app"
      signUpFallbackRedirectUrl="/app"
      afterSignOutUrl="/"
      appearance={clerkAppearance}
    >
      <App />
    </ClerkProvider>
  </StrictMode>,
)
