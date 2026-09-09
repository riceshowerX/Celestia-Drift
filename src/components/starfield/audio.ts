import { warp } from "./state";

export type WarpAudio = {
  resume: () => void;
  update: (speedNorm: number, boost: number) => void;
  dispose: () => void;
};

export function createWarpAudio(): WarpAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let osc: OscillatorNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let shimmerGain: GainNode | null = null;
  let shimmer: OscillatorNode | null = null;
  let lfo: OscillatorNode | null = null;

  function ensure() {
    if (ctx) return;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    // Audio is optional polish (#30): construction can throw (unsupported
    // browser, autoplay-policy hard-block, hardware limits). Degrade to a
    // silent experience instead of bubbling into the "进入星域" click handler.
    try {
      ctx = new AC();
    } catch (err) {
      console.warn("[audio] AudioContext unavailable — running silent:", err);
      return;
    }
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 38;
    filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 160;
    filter.Q.value = 0.7;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.16;
    osc.connect(filter);
    filter.connect(oscGain);
    oscGain.connect(master);
    osc.start();

    shimmer = ctx.createOscillator();
    shimmer.type = "sine";
    shimmer.frequency.value = 740;
    shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0;
    const shimmerFilter = ctx.createBiquadFilter();
    shimmerFilter.type = "highpass";
    shimmerFilter.frequency.value = 420;
    shimmer.connect(shimmerFilter);
    shimmerFilter.connect(shimmerGain);
    shimmerGain.connect(master);
    shimmer.start();

    lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.18;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 8;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfo.start();
  }

  // Background tab: the browser may suspend the context while hidden and it
  // does not always auto-resume on return (#27) — audio was lost for the rest
  // of the session. Re-resume when the tab becomes visible again.
  const onVisibility = () => {
    if (
      document.visibilityState === "visible" &&
      ctx?.state === "suspended"
    ) {
      ctx.resume().catch((err) => console.warn("[audio] resume rejected:", err));
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  return {
    resume() {
      ensure();
      // Autoplay policy can reject resume() (e.g. no user gesture yet); a bare
      // `void` would surface as an unhandledrejection. Warn and move on —
      // update() is a no-op until the context is running, and the next
      // user-gesture resume() retries.
      ctx?.resume().catch((err) => console.warn("[audio] resume rejected:", err));
    },
    update(speedNorm: number, boost: number) {
      if (!ctx || !master || !osc || !filter || !shimmerGain) return;
      if (ctx.state !== "running") return;
      const t = ctx.currentTime;
      // `volume` (#29, renamed from the misleading `silent`): 0 when muted,
      // 1 when audible — a multiplier, not a state flag.
      const volume = warp.muted ? 0 : 1;
      const vol = volume * (0.035 + speedNorm * 0.07 + boost * 0.05);
      master.gain.setTargetAtTime(vol, t, 0.08);
      osc.frequency.setTargetAtTime(34 + speedNorm * 86 + boost * 48, t, 0.1);
      filter.frequency.setTargetAtTime(
        130 + speedNorm * 720 + boost * 1400,
        t,
        0.12,
      );
      shimmerGain.gain.setTargetAtTime(volume * boost * 0.018, t, 0.1);
    },
    dispose() {
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        // Stop EVERY scheduled source (#28): the shimmer oscillator was
        // previously left running (its node was not retained), so `ctx.close()`
        // raced an active source and churned the audio thread.
        osc?.stop();
        shimmer?.stop();
        lfo?.stop();
        // Disconnect the graph root so nothing can reach the output while the
        // context winds down; close() can reject when already closed — nothing
        // to recover, so swallow deliberately.
        master?.disconnect();
        ctx?.close().catch(() => {});
      } catch {
        /* already closed */
      }
      ctx = null;
      master = null;
      osc = null;
      filter = null;
      shimmer = null;
      shimmerGain = null;
      lfo = null;
    },
  };
}
