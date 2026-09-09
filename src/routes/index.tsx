import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";

const loadExperience = () =>
  import("@/components/starfield/StarfieldExperience");
const StarfieldExperience = lazy(loadExperience);
if (typeof window !== "undefined") {
  // Fire-and-forget preload so the chunk is warm by first render. A failed
  // preload is NOT fatal (lazy() retries on first render) — attach a catch so
  // the rejection is swallowed instead of surfacing as an unhandledrejection.
  loadExperience().catch(() => {
    /* preload only — lazy() re-imports and surfaces the real error */
  });
}

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg">
      {mounted ? (
        <Suspense fallback={<Fallback />}>
          <StarfieldExperience />
        </Suspense>
      ) : (
        <Fallback />
      )}
    </main>
  );
}

function Fallback() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center bg-bg px-6 text-center text-fg">
      <p className="font-display text-[0.7rem] font-medium tracking-[0.42em] text-fg-muted">
        星迹
      </p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-[0.28em] text-fg">
        STARWAKE
      </h1>
      <p className="mt-5 max-w-md text-sm text-fg-muted">
        移动指针控制航向。调节速度与星体密度。按住跃迁进入超空间拖影。
      </p>
    </div>
  );
}
