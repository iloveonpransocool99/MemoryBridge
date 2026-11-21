/* ============================================================
   wish-assistant.js — "Help Me Write a Birthday Wish".

   Template-based suggestion writer, fully local. Three languages
   (English, Bahasa Malaysia, Chinese), three tones, simple
   recipient/relationship personalization.

   ARCHITECTURE NOTE (future AI backend):
   generate() checks window.MemoryWishBackend. A future deployment
   can define that object with an `async generate(profile)` method
   that calls a server-side AI endpoint (with any API keys kept on
   the SERVER, never in this frontend file). Until such a backend
   is configured, everything comes from the local templates below,
   and the UI always labels the suggestions as templates.

   Nothing is sent anywhere: no photos, recordings, or messages
   leave the device unless a future backend is explicitly added
   and the user consents.
   ============================================================ */

const WishAssistant = (() => {

  /* ---------------- local templates ----------------
     Each tone × language has openings, middles, and closings that
     combine into a complete wish. {name} and {relationshipWord}
     are substituted. */

  const RELATIONSHIP_WORDS = {
    en: {
      mother: 'Mom', father: 'Dad', grandmother: 'Grandma',
      grandfather: 'Grandpa', spouse: 'my dear', sibling: 'sister or brother',
      friend: 'my friend', family: 'my dear'
    },
    ms: {
      mother: 'Ibu', father: 'Ayah', grandmother: 'Nenek',
      grandfather: 'Datuk', spouse: 'sayangku', sibling: 'abang atau kakak',
      friend: 'sahabatku', family: 'keluargaku tersayang'
    },
    zh: {
      mother: '妈妈', father: '爸爸', grandmother: '奶奶／外婆',
      grandfather: '爷爷／外公', spouse: '亲爱的', sibling: '兄弟姐妹',
      friend: '朋友', family: '亲爱的家人'
    }
  };

  const TEMPLATES = {
    en: {
      warm: [
        { open: 'Happy Birthday, {name}!', mid: 'Having a {rel} like you makes every year brighter.', close: 'With all my love, today and always.' },
        { open: 'Happy Birthday, {name}!', mid: 'Thank you for all the warm memories we have made together.', close: 'I hope your day is as wonderful as you are.' },
        { open: 'Happy Birthday, dear {rel}!', mid: 'You fill our family with love and kindness.', close: 'Wishing you health and happiness all year long.' }
      ],
      joyful: [
        { open: 'Hip hip hooray, {name}!', mid: 'It is time for cake, songs, and big smiles.', close: 'Have the happiest of birthdays!' },
        { open: 'Happy Birthday, {name}!', mid: 'Another wonderful year, another wonderful party.', close: 'Let us celebrate you all day long!' },
        { open: 'Three cheers for {name}!', mid: 'May your day be full of laughter and your cake be full of frosting.', close: 'Happy, happy birthday!' }
      ],
      blessing: [
        { open: 'Happy Birthday, {name}.', mid: 'May the year ahead bring you peace, good health, and gentle joy.', close: 'You are in our hearts and our prayers.' },
        { open: 'Blessings on your birthday, {name}.', mid: 'Thank you for showing our family what quiet strength looks like.', close: 'May every day treat you kindly.' },
        { open: 'Happy Birthday, dear {rel}.', mid: 'May you feel how deeply you are loved today.', close: 'Wishing you a peaceful and blessed year.' }
      ]
    },
    ms: {
      warm: [
        { open: 'Selamat Hari Jadi, {name}!', mid: 'Mempunyai {rel} seperti anda membuat setiap tahun lebih ceria.', close: 'Dengan penuh kasih sayang, hari ini dan selamanya.' },
        { open: 'Selamat Hari Jadi, {name}!', mid: 'Terima kasih atas semua kenangan indah yang kita kongsi bersama.', close: 'Semoga hari anda seindah diri anda.' },
        { open: 'Selamat Hari Jadi, {rel} yang disayangi!', mid: 'Anda memenuhi keluarga kami dengan kasih sayang.', close: 'Moga sihat dan bahagia sepanjang tahun.' }
      ],
      joyful: [
        { open: 'Hooray, {name}!', mid: 'Masa untuk kek, lagu, dan senyuman besar.', close: 'Selamat hari jadi yang paling gembira!' },
        { open: 'Selamat Hari Jadi, {name}!', mid: 'Satu tahun lagi yang indah, satu parti lagi yang meriah.', close: 'Mari kita rayakan anda sepanjang hari!' },
        { open: 'Tiga sorakan untuk {name}!', mid: 'Moga hari anda penuh dengan ketawa dan kek yang sedap.', close: 'Selamat hari jadi!' }
      ],
      blessing: [
        { open: 'Selamat Hari Jadi, {name}.', mid: 'Moga tahun mendatang membawa keamanan, kesihatan, dan kebahagiaan.', close: 'Anda sentiasa dalam doa kami.' },
        { open: 'Selamat Hari Jadi, {name}.', mid: 'Terima kasih kerana menunjukkan kepada kami erti kekuatan yang tenang.', close: 'Moga setiap hari menghormati anda.' },
        { open: 'Selamat Hari Jadi, {rel} yang dikasihi.', mid: 'Moga anda merasakan betapa dalamnya kasih sayang kami hari ini.', close: 'Moga tahun ini penuh keberkatan.' }
      ]
    },
    zh: {
      warm: [
        { open: '{name}，生日快乐！', mid: '有您这样的{rel}，每一年都更加温暖。', close: '永远爱您。' },
        { open: '{name}，生日快乐！', mid: '谢谢您和我们一起创造的每一份美好回忆。', close: '祝您的日子像您一样美好。' },
        { open: '亲爱的{rel}，生日快乐！', mid: '您用爱和温柔填满了我们全家。', close: '祝您一年到头健康幸福。' }
      ],
      joyful: [
        { open: '{name}，生日快乐！', mid: '到了吃蛋糕、唱歌、开心大笑的时候啦！', close: '祝您生日最快乐！' },
        { open: '{name}，生日快乐！', mid: '又美好的一年，又热闹的派对。', close: '让我们为您庆祝一整天！' },
        { open: '为{name}欢呼三声！', mid: '愿您笑声不断，蛋糕甜甜。', close: '生日快乐，生日快乐！' }
      ],
      blessing: [
        { open: '{name}，生日快乐。', mid: '愿新的一年带给您平安、健康和温暖。', close: '您在我们的心里和祝福里。' },
        { open: '{name}，生日快乐。', mid: '谢谢您让全家看到什么是温柔的力量。', close: '愿每一天都善待您。' },
        { open: '亲爱的{rel}，生日快乐。', mid: '愿您在今天感受到我们深深的爱。', close: '祝您福寿安康。' }
      ]
    }
  };

  /* ---------------- generation ---------------- */

  function fill(template, profile) {
    const rel = RELATIONSHIP_WORDS[profile.language][profile.relationship] || '';
    const text = [template.open, template.mid, template.close].join(' ');
    return text
      .replace(/\{name\}/g, profile.recipient || (profile.language === 'zh' ? '亲爱的' : profile.language === 'ms' ? 'yang tersayang' : 'dear friend'))
      .replace(/\{rel\}/g, rel)
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Returns {suggestions: string[], source: 'template'|'ai'}.
   * If a future backend (window.MemoryWishBackend) is configured, it is
   * used; otherwise the local templates answer. Never throws.
   */
  async function generate(profile) {
    if (window.MemoryWishBackend && typeof window.MemoryWishBackend.generate === 'function') {
      try {
        const result = await window.MemoryWishBackend.generate(profile);
        if (result && Array.isArray(result.suggestions) && result.suggestions.length) {
          return { suggestions: result.suggestions.slice(0, 3), source: 'ai' };
        }
      } catch (err) {
        return { suggestions: templateGenerate(profile), source: 'template', backendError: true };
      }
    }
    // Small delay so the "writing…" state is perceivable, not fake — it
    // reflects real template assembly work.
    return { suggestions: templateGenerate(profile), source: 'template' };
  }

  function templateGenerate(profile) {
    const lang = TEMPLATES[profile.language] ? profile.language : 'en';
    const tone = TEMPLATES[lang][profile.tone] ? profile.tone : 'warm';
    return TEMPLATES[lang][tone].map((t) => fill(t, profile));
  }

  return { generate };
})();
