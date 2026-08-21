/* Sample library used only when the dashboard is opened outside the extension. */
(function () {
  const pics = [
    { id: 1018, w: 1200, h: 800, aspect: 1.5 },
    { id: 1020, w: 800, h: 1200, aspect: 0.66 },
    { id: 1035, w: 1200, h: 675, aspect: 1.77 },
    { id: 1040, w: 1200, h: 900, aspect: 1.33 },
    { id: 1043, w: 1200, h: 800, aspect: 1.5 },
    { id: 1050, w: 900, h: 1200, aspect: 0.75 },
    { id: 1062, w: 1200, h: 800, aspect: 1.5 },
    { id: 1080, w: 1200, h: 800, aspect: 1.5 },
    { id: 1084, w: 1200, h: 1200, aspect: 1 },
    { id: 106, w: 1200, h: 800, aspect: 1.5 },
  ];
  function photoItem(id, alt, pos) {
    const p = pics[id % pics.length];
    return {
      type: "photo",
      url: "https://picsum.photos/id/" + p.id + "/" + p.w + "/" + p.h,
      poster: "https://picsum.photos/id/" + p.id + "/" + p.w + "/" + p.h,
      width: p.w, height: p.h, aspect: p.aspect,
      mp4: null, mp4_variants: [], hls: null, duration: 0, alt: alt || "", position: pos || 1
    };
  }
  function videoItem(id, duration, alt) {
    const p = pics[id % pics.length];
    return {
      type: "video",
      url: "https://picsum.photos/id/" + p.id + "/" + p.w + "/" + p.h,
      poster: "https://picsum.photos/id/" + p.id + "/" + p.w + "/" + p.h,
      width: p.w, height: p.h, aspect: p.aspect,
      mp4: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
      mp4_variants: [{ url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4", bitrate: 800000 }],
      hls: null, duration: duration, alt: alt || "", position: 1
    };
  }

  window.XB_DEMO = {
    bookmarks: [
      {
        tweet_id: "1",
        state: "available",
        text: "Golden hour over the ridge — still thinking about this light.",
        type: "tweet",
        author_id: "a1",
        author_username: "lenscraft",
        author_name: "Lena Craft",
        author_profile_image_url: "",
        tweet_created_at: "2026-08-12T18:22:00.000Z",
        tweet_url: "https://x.com/lenscraft/status/1",
        like_count_at_capture: 2400,
        retweet_count_at_capture: 310,
        reply_count_at_capture: 88,
        view_count_at_capture: 92000,
        media_items: [photoItem(0, "Sunlit mountain valley", 1)],
        urls_expanded: [],
        capture_order: 1,
        captured_at: "2026-08-18T10:00:00.000Z"
      },
      {
        tweet_id: "2",
        state: "available",
        text: "Portrait study. Four frames from the same sitting.",
        type: "tweet",
        author_username: "studio.north",
        author_name: "Studio North",
        tweet_created_at: "2026-07-02T12:00:00.000Z",
        tweet_url: "https://x.com/studionorth/status/2",
        like_count_at_capture: 890,
        retweet_count_at_capture: 40,
        reply_count_at_capture: 21,
        view_count_at_capture: 12000,
        media_items: [
          photoItem(1, "Portrait one", 1),
          photoItem(2, "Portrait two", 2),
          photoItem(3, "", 3),
          photoItem(4, "Portrait four", 4)
        ],
        urls_expanded: ["https://example.com/sitting"],
        capture_order: 2,
        captured_at: "2026-08-01T09:00:00.000Z"
      },
      {
        tweet_id: "3",
        state: "available",
        text: "Waves, 48 seconds. Best watched with sound later.",
        type: "tweet",
        author_username: "tidefilm",
        author_name: "Tide Film",
        tweet_created_at: "2026-08-19T08:00:00.000Z",
        tweet_url: "https://x.com/tidefilm/status/3",
        like_count_at_capture: 120,
        retweet_count_at_capture: 12,
        reply_count_at_capture: 4,
        view_count_at_capture: 4000,
        media_items: [videoItem(5, 48000, "Coastal waves")],
        urls_expanded: [],
        capture_order: 3,
        captured_at: "2026-08-20T11:30:00.000Z"
      },
      {
        tweet_id: "4",
        state: "available",
        text: "A looping sketch.",
        type: "tweet",
        author_username: "motionbits",
        author_name: "Motion Bits",
        tweet_created_at: "2026-05-01T08:00:00.000Z",
        tweet_url: "https://x.com/motionbits/status/4",
        like_count_at_capture: 44,
        retweet_count_at_capture: 2,
        reply_count_at_capture: 1,
        view_count_at_capture: 900,
        media_items: [{ type: "animated_gif", url: "https://picsum.photos/id/1025/600/600", poster: "https://picsum.photos/id/1025/600/600", width: 600, height: 600, aspect: 1, mp4: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4", mp4_variants: [{ url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4", bitrate: 250000 }], duration: 3000, alt: "Looping sketch", position: 1 }],
        urls_expanded: [],
        capture_order: 4,
        captured_at: "2026-05-02T08:00:00.000Z"
      },
      {
        tweet_id: "10",
        state: "available",
        text: "Midnight city rain — 12 second loop that never gets old.",
        author_username: "urbanlines",
        author_name: "Urban Lines",
        tweet_created_at: "2026-08-20T22:10:00.000Z",
        tweet_url: "https://x.com/urbanlines/status/10",
        like_count_at_capture: 5200,
        retweet_count_at_capture: 810,
        reply_count_at_capture: 120,
        view_count_at_capture: 210000,
        media_items: [videoItem(6, 12000, "Rain on neon streets")],
        urls_expanded: [],
        capture_order: 5,
        captured_at: "2026-08-21T08:00:00.000Z"
      },
      {
        tweet_id: "11",
        state: "available",
        text: "Two minute wind study — worth the full watch with headphones.",
        author_username: "tidefilm",
        author_name: "Tide Film",
        tweet_created_at: "2026-07-28T16:00:00.000Z",
        tweet_url: "https://x.com/tidefilm/status/11",
        like_count_at_capture: 430,
        retweet_count_at_capture: 55,
        reply_count_at_capture: 18,
        view_count_at_capture: 18000,
        media_items: [videoItem(7, 122000, "Wind through dunes")],
        urls_expanded: [],
        capture_order: 6,
        captured_at: "2026-07-30T10:00:00.000Z"
      },
      {
        tweet_id: "12",
        state: "available",
        text: "Desert geometry. Shot on expired film, scanned at home.",
        author_username: "lenscraft",
        author_name: "Lena Craft",
        tweet_created_at: "2026-06-15T14:00:00.000Z",
        tweet_url: "https://x.com/lenscraft/status/12",
        like_count_at_capture: 3100,
        retweet_count_at_capture: 420,
        reply_count_at_capture: 60,
        view_count_at_capture: 88000,
        media_items: [photoItem(8, "Geometric dunes at sunset, long shadows", 1)],
        urls_expanded: [],
        capture_order: 7,
        captured_at: "2026-06-18T09:00:00.000Z"
      },
      {
        tweet_id: "13",
        state: "available",
        text: "Three frames from Kyoto — one roll, one afternoon.",
        author_username: "lenscraft",
        author_name: "Lena Craft",
        tweet_created_at: "2026-08-10T09:00:00.000Z",
        tweet_url: "https://x.com/lenscraft/status/13",
        like_count_at_capture: 1800,
        retweet_count_at_capture: 120,
        reply_count_at_capture: 34,
        view_count_at_capture: 45000,
        media_items: [photoItem(9, "Torii gate in soft rain", 1), photoItem(0, "Temple garden after rain", 2), photoItem(1, "Lantern detail", 3)],
        urls_expanded: [],
        capture_order: 8,
        captured_at: "2026-08-15T12:00:00.000Z"
      },
      {
        tweet_id: "14",
        state: "available",
        text: "Quick UI concept — 6s interaction study.",
        author_username: "motionbits",
        author_name: "Motion Bits",
        tweet_created_at: "2026-08-19T12:00:00.000Z",
        tweet_url: "https://x.com/motionbits/status/14",
        like_count_at_capture: 260,
        retweet_count_at_capture: 34,
        reply_count_at_capture: 12,
        view_count_at_capture: 7200,
        media_items: [videoItem(3, 6000, "UI hover prototype")],
        urls_expanded: [],
        capture_order: 9,
        captured_at: "2026-08-19T18:00:00.000Z"
      },
      {
        tweet_id: "15",
        state: "available",
        text: "Morning market — captured on iPhone, no edit.",
        author_username: "everydayplaces",
        author_name: "Everyday Places",
        tweet_created_at: "2026-04-12T07:30:00.000Z",
        tweet_url: "https://x.com/everydayplaces/status/15",
        like_count_at_capture: 98,
        retweet_count_at_capture: 8,
        reply_count_at_capture: 3,
        view_count_at_capture: 2100,
        media_items: [photoItem(4, "Market stalls in early light with soft shadows", 1)],
        urls_expanded: [],
        capture_order: 10,
        captured_at: "2026-04-20T08:00:00.000Z"
      },
      {
        tweet_id: "16",
        state: "available",
        text: "Forest walk, 35 seconds. Listen for the birds at 0:20.",
        author_username: "tidefilm",
        author_name: "Tide Film",
        tweet_created_at: "2026-08-05T10:00:00.000Z",
        tweet_url: "https://x.com/tidefilm/status/16",
        like_count_at_capture: 210,
        retweet_count_at_capture: 18,
        reply_count_at_capture: 7,
        view_count_at_capture: 5400,
        media_items: [videoItem(2, 35000, "Forest path with birdsong")],
        urls_expanded: [],
        capture_order: 11,
        captured_at: "2026-08-06T09:00:00.000Z"
      },
      {
        tweet_id: "17",
        state: "available",
        text: "Brutalist balcony study.",
        author_username: "urbanlines",
        author_name: "Urban Lines",
        tweet_created_at: "2026-03-20T11:00:00.000Z",
        tweet_url: "https://x.com/urbanlines/status/17",
        like_count_at_capture: 720,
        retweet_count_at_capture: 44,
        reply_count_at_capture: 12,
        view_count_at_capture: 15000,
        media_items: [photoItem(5, "Concrete balcony with sharp shadow", 1)],
        urls_expanded: [],
        capture_order: 12,
        captured_at: "2026-03-22T10:00:00.000Z"
      },
      {
        tweet_id: "18",
        state: "available",
        text: "Unavailable test — source missing on purpose to show graceful degradation.",
        author_username: "archivist",
        author_name: "Archivist",
        tweet_created_at: "2026-02-10T10:00:00.000Z",
        tweet_url: "https://x.com/archivist/status/18",
        like_count_at_capture: 15,
        retweet_count_at_capture: 1,
        reply_count_at_capture: 0,
        view_count_at_capture: 300,
        media_items: [{ type: "video", url: "", poster: "https://picsum.photos/id/1050/800/600", width: 800, height: 600, aspect: 1.33, mp4: null, mp4_variants: [], hls: null, duration: 45000, alt: "Missing video source", position: 1 }],
        urls_expanded: [],
        capture_order: 13,
        captured_at: "2026-02-12T10:00:00.000Z"
      },
      {
        tweet_id: "19",
        state: "available",
        text: "Wide panorama — prints beautifully at 3:1.",
        author_username: "lenscraft",
        author_name: "Lena Craft",
        tweet_created_at: "2026-07-15T18:00:00.000Z",
        tweet_url: "https://x.com/lenscraft/status/19",
        like_count_at_capture: 950,
        retweet_count_at_capture: 80,
        reply_count_at_capture: 22,
        view_count_at_capture: 22000,
        media_items: [photoItem(6, "Wide desert panorama, 3:1", 1)],
        urls_expanded: [],
        capture_order: 14,
        captured_at: "2026-07-16T10:00:00.000Z"
      },
      {
        tweet_id: "20",
        state: "available",
        text: "Portrait week — daily study 5/7.",
        author_username: "studio.north",
        author_name: "Studio North",
        tweet_created_at: "2026-07-09T12:00:00.000Z",
        tweet_url: "https://x.com/studionorth/status/20",
        like_count_at_capture: 410,
        retweet_count_at_capture: 18,
        reply_count_at_capture: 9,
        view_count_at_capture: 6800,
        media_items: [photoItem(2, "Soft window light portrait", 1)],
        urls_expanded: [],
        capture_order: 15,
        captured_at: "2026-07-10T09:00:00.000Z"
      }
    ]
  };

  // Seed a tiny library for demo: mark a couple viewed, one in-progress, one archived
  // This runs only outside the extension (localStorage mode)
  try {
    const rawLib = localStorage.getItem("xLibraryState");
    if (!rawLib) {
      const demoLibrary = {
        viewed: { "1:1": Date.now() - 86400000 * 2, "2:1": Date.now() - 86400000 * 40, "12:1": Date.now() - 86400000 * 35 },
        archived: {},
        progress: { "3:1": { t: 22, d: 48 }, "11:1": { t: 18, d: 122 } },
        lastOpened: { "3:1": Date.now() - 86400000, "11:1": Date.now() - 3600000 * 5 }
      };
      localStorage.setItem("xLibraryState", JSON.stringify(demoLibrary));
      const rawPrefs = localStorage.getItem("xDashboardPrefs");
      let prefs = rawPrefs ? JSON.parse(rawPrefs) : {};
      prefs.recentSearches = ["architecture", "cinematic", "portrait"];
      prefs.railScrolls = {};
      localStorage.setItem("xDashboardPrefs", JSON.stringify(prefs));
    }
  } catch {}
})();
