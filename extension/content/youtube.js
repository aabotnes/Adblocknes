// Fallback for YouTube ads that still reach the player, for example when
// YouTube stitches the ad into the video stream itself. While an ad is
// showing: mute it, click "Skip" as soon as it exists, and fast-forward.
// Your volume and speed are restored when the video comes back.
(() => {
  'use strict';

  const SKIP = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-overlay-close-button',
  ].join(',');

  // A separate ad video is short. If the "ad" is as long as a real video, it
  // was stitched into the stream, and seeking to the end would skip the video
  // too, so it is only sped up.
  const MAX_SEPARATE_AD_SECONDS = 180;

  let saved = null;

  function tick() {
    const player = document.querySelector('.html5-video-player');
    const video = player?.querySelector('video');

    if (player && video && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) {
      if (!saved) saved = { muted: video.muted, rate: video.playbackRate };
      video.muted = true;
      for (const button of player.querySelectorAll(SKIP)) button.click();
      if (Number.isFinite(video.duration) && video.duration > 0 && video.duration <= MAX_SEPARATE_AD_SECONDS) {
        if (video.currentTime < video.duration - 0.25) video.currentTime = video.duration - 0.1;
      } else if (video.playbackRate < 16) {
        video.playbackRate = 16;
      }
    } else if (saved && video) {
      video.muted = saved.muted;
      video.playbackRate = saved.rate;
      saved = null;
    }

    // "Ad blockers are not allowed" pop-up: remove it and resume the video.
    const wall = document.querySelector('ytd-enforcement-message-view-model');
    if (wall) {
      (wall.closest('tp-yt-paper-dialog') || wall).remove();
      document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((b) => b.remove());
      if (video?.paused) video.play().catch(() => {});
    }
  }

  // React quickly when the player switches to an ad, at most once per frame.
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      tick();
    });
  };
  setInterval(tick, 500);
  new MutationObserver(schedule).observe(document, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
})();
