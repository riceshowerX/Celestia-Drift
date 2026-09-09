import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

const APP_NAME = "Starwake";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
      },
      { title: APP_NAME },
      { name: "description", content: "Immersive 3D warp-speed starfield." },
      { name: "theme-color", content: "#050508" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        // #86: crossorigin so Google's error/telemetry responses (and any
        // redirect chain) stay in CORS mode with usable diagnostics. SRI is
        // NOT applicable here: Google serves this CSS with rotating content
        // (UA-dependent rules, updated font-file URLs on fonts.gstatic.com),
        // so any integrity hash would break on Google's side. Real hardening
        // would be a CSP response header (e.g. script-src 'self' +
        // style-src fonts.googleapis.com 'unsafe-inline') set at the edge —
        // intentionally not inlined as a meta tag here (meta CSP cannot
        // cover frame/worker contexts reliably and would pin policy into
        // code).
        crossOrigin: "anonymous",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Sora:wght@500;600&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: () => (
    <html lang="zh-CN" suppressHydrationWarning className="antialiased">
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
