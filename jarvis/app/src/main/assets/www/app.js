/* J.A.R.V.I.S — web UI + brain.
 * Runs inside the Android WebView (window.JarvisNative is the native bridge)
 * and, with reduced device features, in any modern browser. */
(function () {
  'use strict';

  var N = window.JarvisNative || null;
  var $ = function (id) { return document.getElementById(id); };
  var app = $('app'), log = $('log'), statusEl = $('status'), input = $('input');

  // ------------------------------------------------------------------ text
  var T = {
    si: {
      placeholder: 'මෙතන ටයිප් කරන්න…',
      idle: 'කතා කරන්න orb එක ඔබන්න',
      listening: 'අහගෙන ඉන්නවා…',
      thinking: 'හිතමින්…',
      speaking: 'කතා කරමින්…',
      settings: 'සැකසුම්',
      provider: 'AI සේවාව',
      apiKey: 'API key',
      keyHelp: 'Gemini සඳහා නොමිලේ key එකක් aistudio.google.com/apikey වෙතින් ගන්න පුළුවන්.',
      model: 'Model',
      callMe: 'ඔබව අමතන්න ඕන නම',
      voiceReplies: 'පිළිතුරු හඬින් කියන්න',
      clearMemory: 'මතකය මකන්න',
      save: 'සුරකින්න',
      privacy: 'API key එක සහ කතාබහ මේ දුරකථනයේ පමණක් ගබඩා වේ. ඔබේ පණිවිඩ යන්නේ ඔබ තෝරාගත් AI සේවාවට පමණි.',
      saved: 'සුරැකුවා',
      cleared: 'මතකය මැකුවා',
      handsOn: 'Hands-free සක්‍රියයි — පිළිතුරෙන් පස්සේ ආයෙත් අහගෙන ඉන්නවා',
      handsOff: 'Hands-free අක්‍රියයි',
      noSpeech: 'මට මුකුත් ඇහුණේ නෑ. ආයෙත් උත්සාහ කරන්න.',
      micDenied: 'Microphone අවසරය දෙන්න ඕන.',
      sttUnavailable: 'මේ උපාංගයේ voice recognition නැහැ. Google app එක install/update කරන්න.',
      sttNetwork: 'Voice recognition සඳහා internet සම්බන්ධතාව බලන්න.',
      ttsMissing: 'මේ භාෂාවට හඬක් install වෙලා නැහැ. Settings → Text-to-speech → Google → සිංහල voice data install කරන්න.',
      needKey: 'ඒකට උත්තර දෙන්න මට AI සම්බන්ධතාවක් ඕන, {name}. උඩ තියෙන ⚙ ඔබලා API key එකක් දාන්න. එතකන් වෙලාව, දිනය, බැටරිය, ටෝච් එක, apps open කිරීම සහ search කිරීම මට කරන්න පුළුවන්.',
      errKey: 'API key එක වැරදියි හෝ අවසර නැහැ. සැකසුම් බලන්න.',
      errModel: 'Model නම හොයාගන්න බැහැ. සැකසුම්වල model නම බලන්න.',
      errQuota: 'දැනට requests සීමාව ඉක්මවලා. ටිකකින් ආයෙත් උත්සාහ කරන්න.',
      errNet: 'AI සේවාවට සම්බන්ධ වෙන්න බැරි වුණා. Internet එක බලන්න.',
      errEmpty: 'AI සේවාවෙන් හිස් පිළිතුරක් ආවා. ආයෙත් අහන්න.',
      morning: 'සුබ උදෑසනක්', afternoon: 'සුබ දහවලක්', evening: 'සුබ සන්ධ්‍යාවක්', night: 'සුබ රාත්‍රියක්',
      online: '{greet}, {name}. ජාවිස් සූදානම්. මම මොනවද කරන්න ඕන?',
      timeIs: 'දැන් වේලාව {p} {h}යි {m}යි, {name}.',
      am: 'පෙරවරු', pm: 'පස්වරු',
      dateIs: 'අද {d}, {name}.',
      batteryIs: 'බැටරිය සියයට {n}ක් තියෙනවා, {name}.',
      batteryUnknown: 'බැටරි මට්ටම කියවන්න බැරි වුණා.',
      torchOn: 'ටෝච් එක දැම්මා.', torchOff: 'ටෝච් එක නිවුවා.', torchFail: 'මේ උපාංගයේ ටෝච් එක පාලනය කරන්න බැහැ.',
      opening: '{x} open කරනවා.', notFound: '{x} කියලා app එකක් හොයාගන්න බැරි වුණා.',
      searching: '"{x}" ගැන හොයනවා.', playing: 'YouTube එකේ "{x}" හොයනවා.',
      hello: 'ආයුබෝවන්, {name}. මම සූදානම්.',
      whoAmI: 'මම ජාවිස්. ඔබේ පුද්ගලික AI සහායකයා, {name}.',
      aOpen: '▸ {x} open කළා', aOpenFail: '▸ {x} හමු වුණේ නෑ', aSearch: '▸ සෙවීම: {x}', aYoutube: '▸ YouTube: {x}',
      aCall: '▸ ඇමතුම: {x}', aAlarm: '▸ Alarm: {x}', aTimer: '▸ Timer: තත්පර {x}', aMaps: '▸ Maps: {x}',
      aTorch: '▸ ටෝච්: {x}', aFail: '▸ {x} කරන්න බැරි වුණා',
      quick: ['වෙලාව කීයද?', 'අද දවස මොකක්ද?', 'YouTube open කරන්න', 'විහිළුවක් කියන්න', 'බැටරිය කීයද?']
    },
    en: {
      placeholder: 'Type here…',
      idle: 'Tap the orb to talk',
      listening: 'Listening…',
      thinking: 'Thinking…',
      speaking: 'Speaking…',
      settings: 'Settings',
      provider: 'AI provider',
      apiKey: 'API key',
      keyHelp: 'A free Gemini key is available at aistudio.google.com/apikey.',
      model: 'Model',
      callMe: 'What should I call you',
      voiceReplies: 'Speak replies aloud',
      clearMemory: 'Clear memory',
      save: 'Save',
      privacy: 'Your API key and conversation are stored only on this phone. Messages are sent only to the AI provider you choose.',
      saved: 'Saved',
      cleared: 'Memory cleared',
      handsOn: 'Hands-free on — I keep listening after each reply',
      handsOff: 'Hands-free off',
      noSpeech: "I didn't catch anything. Please try again.",
      micDenied: 'Microphone permission is required.',
      sttUnavailable: 'Voice recognition is not available on this device. Install or update the Google app.',
      sttNetwork: 'Check the internet connection for voice recognition.',
      ttsMissing: 'No voice is installed for this language. Install it under Settings → Text-to-speech → Google.',
      needKey: 'I need an AI connection to answer that, {name}. Tap ⚙ above and add an API key. Until then I can tell the time, date and battery, switch the torch, open apps and search.',
      errKey: 'The API key is invalid or not permitted. Check settings.',
      errModel: 'That model was not found. Check the model name in settings.',
      errQuota: 'The request limit has been reached. Try again shortly.',
      errNet: 'Could not reach the AI service. Check the internet connection.',
      errEmpty: 'The AI service returned an empty reply. Please ask again.',
      morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Good evening',
      online: '{greet}, {name}. JARVIS online. How may I assist?',
      timeIs: 'It is {h}:{m} {p}, {name}.',
      am: 'AM', pm: 'PM',
      dateIs: 'Today is {d}, {name}.',
      batteryIs: 'Battery is at {n} percent, {name}.',
      batteryUnknown: 'I could not read the battery level.',
      torchOn: 'Torch on.', torchOff: 'Torch off.', torchFail: 'I cannot control the torch on this device.',
      opening: 'Opening {x}.', notFound: 'I could not find an app called {x}.',
      searching: 'Searching for "{x}".', playing: 'Looking up "{x}" on YouTube.',
      hello: 'Hello, {name}. At your service.',
      whoAmI: 'I am JARVIS, your personal AI assistant, {name}.',
      aOpen: '▸ Opened {x}', aOpenFail: '▸ {x} not found', aSearch: '▸ Search: {x}', aYoutube: '▸ YouTube: {x}',
      aCall: '▸ Call: {x}', aAlarm: '▸ Alarm: {x}', aTimer: '▸ Timer: {x}s', aMaps: '▸ Maps: {x}',
      aTorch: '▸ Torch: {x}', aFail: '▸ Could not do {x}',
      quick: ['What time is it?', "What's the date today?", 'Open YouTube', 'Tell me a joke', 'Battery level?']
    }
  };

  // -------------------------------------------------------------- settings
  var DEFAULT_MODEL = { gemini: 'gemini-2.5-flash', openai: 'gpt-4o-mini' };
  var cfg = load('jarvis.settings', {});
  cfg = {
    lang: cfg.lang || 'si',
    provider: cfg.provider || 'gemini',
    key: cfg.key || '',
    model: cfg.model || '',
    base: cfg.base || 'https://api.openai.com/v1',
    name: cfg.name || '',
    voice: cfg.voice !== false,
    hands: !!cfg.hands
  };
  var history = load('jarvis.history', []);
  var state = 'idle';
  var lastWasVoice = false;
  var greeted = false;
  var busy = false;

  function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } }
  function L() { return T[cfg.lang]; }
  function name() { return cfg.name || (cfg.lang === 'si' ? 'සර්' : 'Sir'); }
  function t(key, vars) {
    var s = L()[key] || key;
    vars = vars || {};
    vars.name = name();
    return s.replace(/\{(\w+)\}/g, function (_, k) { return vars[k] != null ? vars[k] : ''; });
  }
  function isSinhala(s) { return /[\u0D80-\u0DFF]/.test(s); }

  // -------------------------------------------------------------------- ui
  function setState(s, text) {
    state = s;
    app.dataset.state = s;
    statusEl.textContent = text != null ? text : L()[s];
  }
  function addMsg(role, text, extra) {
    var el = document.createElement('div');
    el.className = 'msg ' + role;
    el.textContent = text;
    if (extra && extra.length) {
      extra.forEach(function (x) {
        var a = document.createElement('span');
        a.className = 'act';
        a.textContent = x;
        el.appendChild(a);
      });
    }
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    app.classList.toggle('compact', log.children.length > 2);
    return el;
  }
  var toastTimer;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3800);
  }
  function applyLang() {
    document.documentElement.lang = cfg.lang;
    $('langBtn').textContent = cfg.lang === 'si' ? 'සිං' : 'EN';
    input.placeholder = L().placeholder;
    document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = L()[el.dataset.t]; });
    $('handsBtn').classList.toggle('on', cfg.hands);
    var q = $('quick');
    q.textContent = '';
    L().quick.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = s;
      b.onclick = function () { lastWasVoice = false; handleUser(s); };
      q.appendChild(b);
    });
    if (state === 'idle') setState('idle');
  }
  function tick() {
    var d = new Date();
    $('clock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '  ·  ' +
      d.toLocaleDateString(cfg.lang === 'si' ? 'si-LK' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  // ---------------------------------------------------------------- speech
  var webRec = null;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function sttLang() { return cfg.lang === 'si' ? 'si-LK' : 'en-US'; }

  function listen() {
    if (busy) return;
    stopSpeaking();
    if (N) {
      setState('listening');
      N.startListening(sttLang());
      return;
    }
    if (!SR) { toast(L().sttUnavailable); return; }
    try {
      var got = false;
      webRec = new SR();
      webRec.lang = sttLang();
      webRec.interimResults = true;
      webRec.onresult = function (e) {
        var r = e.results[e.results.length - 1];
        if (r.isFinal) { got = true; bridge.onEvent('stt_final', r[0].transcript); }
        else bridge.onEvent('stt_partial', r[0].transcript);
      };
      webRec.onerror = function (e) {
        got = true;
        bridge.onEvent('stt_error', e.error === 'not-allowed' ? 'permission' : e.error === 'network' ? 'network' : e.error === 'aborted' ? 'cancelled' : 'nospeech');
      };
      webRec.onend = function () { if (!got && state === 'listening') bridge.onEvent('stt_error', 'nospeech'); };
      webRec.start();
      setState('listening');
    } catch (e) { toast(L().sttUnavailable); setState('idle'); }
  }
  function stopListening() {
    if (N) N.stopListening();
    else if (webRec) { try { webRec.abort(); } catch (e) { /* already stopped */ } }
    setState('idle');
  }
  function stopSpeaking() {
    if (N) N.stopSpeaking();
    else if (window.speechSynthesis) window.speechSynthesis.cancel();
  }
  function speak(text) {
    var clean = text.replace(/[*_#`>~⚙▸]/g, '').replace(/https?:\/\/\S+/g, '').trim();
    if (!cfg.voice || !clean) { afterSpeak(); return; }
    var lang = isSinhala(clean) ? 'si-LK' : 'en-GB';
    setState('speaking');
    if (N) { N.speak(clean, lang); return; }
    if (!window.speechSynthesis) { afterSpeak(); return; }
    var u = new SpeechSynthesisUtterance(clean);
    u.lang = lang;
    var v = window.speechSynthesis.getVoices().filter(function (x) { return x.lang.replace('_', '-').indexOf(lang.slice(0, 2)) === 0; })[0];
    if (v) u.voice = v;
    else if (lang === 'si-LK') { toast(L().ttsMissing); afterSpeak(); return; }
    u.onend = u.onerror = function () { if (state === 'speaking') afterSpeak(); };
    window.speechSynthesis.speak(u);
  }
  function afterSpeak() {
    setState('idle');
    if (cfg.hands && lastWasVoice) setTimeout(function () { if (state === 'idle' && !busy) listen(); }, 350);
  }

  // Events from the native shell (or the browser fallbacks above).
  var bridge = window.JarvisBridge = {
    onEvent: function (type, data) {
      switch (type) {
        case 'stt_partial':
          if (state === 'listening') statusEl.textContent = data;
          break;
        case 'stt_final':
          if (state !== 'listening') break;
          if (data && data.trim()) { lastWasVoice = true; handleUser(data.trim()); }
          else { setState('idle'); toast(L().noSpeech); }
          break;
        case 'stt_error':
          if (state !== 'listening') break;
          setState('idle');
          if (data === 'nospeech') toast(L().noSpeech);
          else if (data === 'permission') toast(L().micDenied);
          else if (data === 'network') toast(L().sttNetwork);
          else if (data !== 'cancelled') toast(L().sttUnavailable);
          break;
        case 'tts_done':
          if (state === 'speaking') afterSpeak();
          break;
        case 'tts_missing':
          toast(L().ttsMissing);
          break;
        case 'tts_ready':
          if (data === '1') greetAloud();
          break;
      }
    }
  };

  // --------------------------------------------------------------- actions
  var WEB_APPS = {
    youtube: 'https://www.youtube.com', whatsapp: 'https://web.whatsapp.com', maps: 'https://maps.google.com',
    gmail: 'https://mail.google.com', facebook: 'https://www.facebook.com', instagram: 'https://www.instagram.com',
    google: 'https://www.google.com', chrome: 'https://www.google.com', tiktok: 'https://www.tiktok.com'
  };
  function openUrl(url) {
    if (N) return N.openUrl(url);
    window.open(url, '_blank', 'noopener');
    return true;
  }
  function openApp(x) {
    if (N) return N.openApp(x);
    var u = WEB_APPS[x.toLowerCase().replace(/\s+/g, '')];
    return u ? openUrl(u) : false;
  }
  function f(key, x) { return L()[key].replace('{x}', x); }

  /** Runs one action and returns a short label describing what happened. */
  function runAction(kind, arg) {
    arg = (arg || '').trim();
    switch (kind) {
      case 'open_app':
        return openApp(arg) ? f('aOpen', arg) : f('aOpenFail', arg);
      case 'search':
        openUrl('https://www.google.com/search?q=' + encodeURIComponent(arg));
        return f('aSearch', arg);
      case 'youtube':
        openUrl('https://www.youtube.com/results?search_query=' + encodeURIComponent(arg));
        return f('aYoutube', arg);
      case 'maps':
        openUrl('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(arg));
        return f('aMaps', arg);
      case 'url':
        if (!/^https?:\/\//i.test(arg)) return f('aFail', arg);
        openUrl(arg);
        return '▸ ' + arg;
      case 'call': {
        var num = arg.replace(/[^\d+*#]/g, '');
        if (!num) return f('aFail', 'call');
        var ok = N ? N.dial(num) : openUrl('tel:' + num);
        return ok ? f('aCall', num) : f('aFail', 'call');
      }
      case 'alarm': {
        var m = arg.match(/^(\d{1,2})[:.](\d{2})$/);
        if (!m || +m[1] > 23 || +m[2] > 59 || !N) return f('aFail', 'alarm');
        return N.setAlarm(+m[1], +m[2], 'J.A.R.V.I.S') ? f('aAlarm', m[1] + ':' + m[2]) : f('aFail', 'alarm');
      }
      case 'timer': {
        var s = parseInt(arg, 10);
        if (!(s > 0) || !N) return f('aFail', 'timer');
        return N.setTimer(s, 'J.A.R.V.I.S') ? f('aTimer', s) : f('aFail', 'timer');
      }
      case 'torch': {
        var on = /^(on|1|true)$/i.test(arg);
        return N && N.torch(on) ? f('aTorch', on ? 'ON' : 'OFF') : f('aFail', 'torch');
      }
    }
    return null;
  }

  // --------------------------------------------------- built-in (offline) skills
  function batteryLevel() {
    if (N) return Promise.resolve(N.battery());
    if (navigator.getBattery) return navigator.getBattery().then(function (b) { return Math.round(b.level * 100); });
    return Promise.resolve(-1);
  }

  /** Returns a reply (or a promise of one) when the request can be handled on-device, else null. */
  function localSkill(text) {
    var s = text.toLowerCase().trim();
    var m;

    if (/(ටෝච්|ටෝච|ෆ්ලෑෂ්|flash ?light|torch)/.test(s)) {
      var off = /(off|ඕෆ්|ඔෆ්|නිවන්න|නිවලා|නවත්ත|අයින්)/.test(s);
      var done = N ? N.torch(!off) : false;
      return done ? t(off ? 'torchOff' : 'torchOn') : t('torchFail');
    }
    if (/(වෙලාව|වේලාව|welawa|what(?:'s| is)? the time|what time|time now|current time)/.test(s)) {
      var d = new Date(), h = d.getHours(), mi = d.getMinutes();
      return t('timeIs', { p: L()[h < 12 ? 'am' : 'pm'], h: h % 12 || 12, m: cfg.lang === 'si' ? mi : ('0' + mi).slice(-2) });
    }
    if (/(දිනය|අද දවස|අද මොන|අද කීය|today'?s date|what(?:'s| is) the date|what day)/.test(s)) {
      return t('dateIs', {
        d: new Date().toLocaleDateString(cfg.lang === 'si' ? 'si-LK' : 'en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
      });
    }
    if (/(බැටරි|battery|චාජ් එක)/.test(s)) {
      return batteryLevel().then(function (n) { return n >= 0 ? t('batteryIs', { n: n }) : t('batteryUnknown'); });
    }

    if (cfg.key) return null; // everything else goes to the AI when it is connected

    if ((m = s.match(/^(?:open|launch|start)\s+(.+)$/)) || (m = s.match(/^(.+?)\s*(?:එක\s*)?(?:open|ඕපන්|විවෘත)\s*කරන්න/))) {
      return openApp(m[1].trim()) ? t('opening', { x: m[1].trim() }) : t('notFound', { x: m[1].trim() });
    }
    if ((m = s.match(/^(?:search(?: for)?|google)\s+(.+)$/)) || (m = s.match(/^(.+?)\s*(?:ගැන\s*)?(?:සොයන්න|හොයන්න|search\s*කරන්න)/))) {
      runAction('search', m[1]);
      return t('searching', { x: m[1].trim() });
    }
    if ((m = s.match(/^play\s+(.+)$/)) || (m = s.match(/^(.+?)\s*(?:play|ප්ලේ)\s*කරන්න/))) {
      runAction('youtube', m[1]);
      return t('playing', { x: m[1].trim() });
    }
    if (/^(?:(?:hi|hello|hey)(?=$|[\s,.!])|හායි|හෙලෝ|හලෝ|ආයුබෝවන්|කොහොමද)/.test(s)) return t('hello');
    if (/(who are you|your name|ඔයා කවුද|ඔබ කවුද|නම මොකක්ද)/.test(s)) return t('whoAmI');
    return t('needKey');
  }

  // --------------------------------------------------------------------- AI
  function systemPrompt() {
    var now = new Date();
    return [
      'You are J.A.R.V.I.S, the personal AI assistant of the user, running as an app on their Android phone.',
      'Personality: calm, precise, loyal, with dry understated wit — like a brilliant butler. Address the user as "' + name() + '".',
      'LANGUAGE: The user speaks Sinhala and English. If the user writes in Sinhala script or in Singlish (Sinhala typed with English letters), reply in natural spoken Sinhala written in Sinhala script. If the user writes in English, reply in English. The app language is currently set to ' + (cfg.lang === 'si' ? 'Sinhala' : 'English') + '; use it when the user\'s language is unclear.',
      'STYLE: Your reply is read aloud by a text-to-speech voice. Keep it short — one to three sentences unless the user asks for detail. Plain text only: no markdown, no bullet symbols, no emojis.',
      'Current date and time on the phone: ' + now.toString() + '.',
      'DEVICE ACTIONS: When the user asks you to do something on the phone, add the matching tag at the very end of your reply. Available tags:',
      '[[open_app:App Name]] open an installed app (use its English name, e.g. YouTube, WhatsApp, Camera)',
      '[[search:query]] Google search',
      '[[youtube:query]] search YouTube for a song or video',
      '[[maps:place]] show a place or directions in Google Maps',
      '[[call:phone number]] open the dialler with a number',
      '[[alarm:HH:MM]] set an alarm, 24-hour time',
      '[[timer:seconds]] start a countdown timer',
      '[[torch:on]] or [[torch:off]] switch the flashlight',
      'Use a tag only when the user actually asked for that action, and still say a brief confirmation in words. Never mention the tags themselves.',
      'Be honest: if you do not know something or cannot do it, say so plainly.'
    ].join('\n');
  }

  function httpError(status) {
    var e = new Error('http ' + status);
    e.status = status;
    return e;
  }

  function askAI(turns) {
    var model = cfg.model || DEFAULT_MODEL[cfg.provider];
    var url, opts;
    if (cfg.provider === 'gemini') {
      url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
      opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt() }] },
          contents: turns.map(function (m) { return { role: m.role === 'bot' ? 'model' : 'user', parts: [{ text: m.text }] }; }),
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
        })
      };
    } else {
      url = cfg.base.replace(/\/+$/, '') + '/chat/completions';
      opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
        body: JSON.stringify({
          model: model,
          temperature: 0.7,
          messages: [{ role: 'system', content: systemPrompt() }].concat(
            turns.map(function (m) { return { role: m.role === 'bot' ? 'assistant' : 'user', content: m.text }; }))
        })
      };
    }
    return fetch(url, opts).then(function (r) {
      if (!r.ok) throw httpError(r.status);
      return r.json();
    }).then(function (j) {
      var out = '';
      if (cfg.provider === 'gemini') {
        var parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
        out = parts.map(function (p) { return p.text || ''; }).join('');
      } else {
        out = ((((j.choices || [])[0] || {}).message || {}).content) || '';
      }
      out = out.trim();
      if (!out) throw new Error('empty');
      return out;
    });
  }

  function errorText(e) {
    if (e.message === 'empty') return L().errEmpty;
    if (e.status === 400 || e.status === 401 || e.status === 403) return L().errKey;
    if (e.status === 404) return L().errModel;
    if (e.status === 429) return L().errQuota;
    return L().errNet + (e.status ? ' (HTTP ' + e.status + ')' : '');
  }

  // ------------------------------------------------------------------- flow
  function remember(role, text) {
    history.push({ role: role, text: text });
    if (history.length > 24) history = history.slice(-24);
    save('jarvis.history', history);
  }

  function reply(raw) {
    var labels = [];
    var text = raw.replace(/\[\[\s*([a-z_]+)\s*:\s*([^\]]*)\]\]/gi, function (_, kind, arg) {
      var label = runAction(kind.toLowerCase(), arg);
      if (label) labels.push(label);
      return '';
    }).replace(/\*\*/g, '').trim();
    addMsg('bot', text, labels);
    remember('bot', text || labels.join(' '));
    speak(text);
  }

  function handleUser(text) {
    if (busy || !text) return;
    stopSpeaking();
    addMsg('user', text);
    input.value = '';
    busy = true;
    setState('thinking');

    Promise.resolve()
      .then(function () { return localSkill(text); })
      .then(function (local) {
        remember('user', text);
        if (local != null) return local;
        return askAI(history.slice(-16));
      })
      .then(function (out) { busy = false; reply(out); })
      .catch(function (e) {
        busy = false;
        var msg = errorText(e);
        addMsg('bot err', msg);
        speak(msg);
      });
  }

  function greeting() {
    var h = new Date().getHours();
    var g = h < 12 ? 'morning' : h < 16 ? 'afternoon' : h < 20 ? 'evening' : 'night';
    return t('online', { greet: L()[g] });
  }
  function greetAloud() {
    if (greeted || !N || !cfg.voice || state !== 'idle') return;
    greeted = true;
    speak(log.firstChild ? log.firstChild.textContent : greeting());
  }

  // ----------------------------------------------------------------- events
  $('orb').onclick = $('micBtn').onclick = function () {
    if (state === 'listening') stopListening();
    else if (state === 'speaking') { stopSpeaking(); setState('idle'); listen(); }
    else if (state === 'idle') listen();
  };
  $('form').onsubmit = function (e) {
    e.preventDefault();
    lastWasVoice = false;
    handleUser(input.value.trim());
  };
  $('langBtn').onclick = function () {
    cfg.lang = cfg.lang === 'si' ? 'en' : 'si';
    save('jarvis.settings', cfg);
    applyLang();
    tick();
  };
  $('handsBtn').onclick = function () {
    cfg.hands = !cfg.hands;
    save('jarvis.settings', cfg);
    applyLang();
    toast(cfg.hands ? L().handsOn : L().handsOff);
  };

  var sheet = $('sheet');
  function syncProviderFields() {
    var p = $('sProvider').value;
    $('sBaseWrap').style.display = p === 'openai' ? '' : 'none';
    $('sModel').placeholder = DEFAULT_MODEL[p];
  }
  $('setBtn').onclick = function () {
    $('sProvider').value = cfg.provider;
    $('sKey').value = cfg.key;
    $('sModel').value = cfg.model;
    $('sBase').value = cfg.base;
    $('sName').value = cfg.name;
    $('sName').placeholder = name();
    $('sVoice').checked = cfg.voice;
    syncProviderFields();
    sheet.hidden = false;
  };
  $('sProvider').onchange = syncProviderFields;
  sheet.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) sheet.hidden = true;
  });
  $('sSave').onclick = function () {
    cfg.provider = $('sProvider').value;
    cfg.key = $('sKey').value.trim();
    cfg.model = $('sModel').value.trim();
    cfg.base = $('sBase').value.trim() || 'https://api.openai.com/v1';
    cfg.name = $('sName').value.trim();
    cfg.voice = $('sVoice').checked;
    save('jarvis.settings', cfg);
    sheet.hidden = true;
    toast(L().saved);
  };
  $('sClear').onclick = function () {
    history = [];
    save('jarvis.history', history);
    log.textContent = '';
    app.classList.remove('compact');
    sheet.hidden = true;
    toast(L().cleared);
  };

  // ------------------------------------------------------------------- boot
  applyLang();
  tick();
  setInterval(tick, 20000);
  addMsg('bot', greeting());
  if (N && N.isTtsReady()) greetAloud();
  if (window.speechSynthesis) window.speechSynthesis.getVoices(); // warm up the browser voice list
})();
