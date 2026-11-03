const form = document.getElementById('chat-form');
const input = document.getElementById('user-input');
const chatBox = document.getElementById('chat-box');
const sendBtn = document.getElementById('send-btn');
const micBtn = document.getElementById('mic-btn');

const sessionListEl = document.getElementById('session-list');
const progressCountText = document.getElementById('progress-count-text');
const progressBarFill = document.getElementById('progress-bar-fill');
const activeSessionHeaderText = document.getElementById('active-session-header-text');
const bannerSessionBadge = document.getElementById('banner-session-badge');
const bannerSessionTitle = document.getElementById('banner-session-title');
const bannerSessionSummary = document.getElementById('banner-session-summary');
const bannerSessionGoal = document.getElementById('banner-session-goal');

const completeSessionBtn = document.getElementById('complete-session-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const resetProgressBtn = document.getElementById('reset-progress-btn');
const quickActionsContainer = document.getElementById('quick-actions');
const sidebar = document.getElementById('sidebar');
const openSidebarBtn = document.getElementById('open-sidebar-btn');
const closeSidebarBtn = document.getElementById('close-sidebar-btn');

// Live Voice Elements
const openLiveVoiceBtn = document.getElementById('open-live-voice-btn');
const liveVoiceOverlay = document.getElementById('live-voice-overlay');
const closeLiveVoiceBtn = document.getElementById('close-live-voice-btn');
const toggleLiveMicBtn = document.getElementById('toggle-live-mic-btn');
const stopTtsBtn = document.getElementById('stop-tts-btn');
const voiceLangSelect = document.getElementById('voice-lang-select');
const liveOrb = document.getElementById('live-orb');
const liveOrbIcon = document.getElementById('live-orb-icon');
const liveStatusTitle = document.getElementById('live-status-title');
const liveTranscriptText = document.getElementById('live-transcript-text');

const STORAGE_KEY = 'lingomate_progress_v1';

// Riwayat percakapan sesuai format backend Sesi 3: Array of { role: 'user' | 'model', text: string }
let conversation = [];
let sessions = [];
let currentMode = 'auto';

// State progres sesi (disimpan per sesi, bukan per hari)
let progress = loadProgress();

// State Speech Recognition (untuk tombol mic dikte di sebelah input teks)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let dictRecognition = null;
let isDictatingInput = false;

// State Gemini 3.8 Live API (WebSocket Bidirectional Audio)
let liveWs = null;
let isLiveSessionOpen = false;
let isMicMutedInLive = false;
let micStream = null;
let micAudioCtx = null;
let micProcessor = null;
let playbackAudioCtx = null;
let nextPlayTime = 0;
let activeAudioSources = [];
let currentInputTranscript = '';
let currentOutputTranscript = '';

if (window.marked) {
  marked.setOptions({
    breaks: true,
    gfm: true
  });
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        currentSession: Number(parsed.currentSession) || 1,
        completedSessions: Array.isArray(parsed.completedSessions)
          ? parsed.completedSessions
          : []
      };
    }
  } catch (err) {
    console.warn('Gagal membaca localStorage:', err);
  }
  return { currentSession: 1, completedSessions: [] };
}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch (err) {
    console.warn('Gagal menyimpan localStorage:', err);
  }
}

function renderMarkdown(rawText) {
  if (window.marked && window.DOMPurify) {
    const html = marked.parse(rawText);
    return DOMPurify.sanitize(html);
  } else if (window.marked) {
    return marked.parse(rawText);
  }
  const div = document.createElement('div');
  div.textContent = rawText;
  return div.innerHTML.replace(/\n/g, '<br>');
}

function stripMarkdownForSpeech(markdownText) {
  return String(markdownText || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*_~`#>|-]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function speakTextBrowser(rawText, onEndCallback = null) {
  if (!('speechSynthesis' in window)) {
    if (onEndCallback) onEndCallback();
    return;
  }

  window.speechSynthesis.cancel();
  const cleanText = stripMarkdownForSpeech(rawText);
  if (!cleanText) {
    if (onEndCallback) onEndCallback();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(cleanText);
  const voices = window.speechSynthesis.getVoices();
  const preferredEnVoice =
    voices.find((v) => v.lang.startsWith('en') && /natural|online|google|samantha|aria|guy/i.test(v.name)) ||
    voices.find((v) => v.lang.startsWith('en-US')) ||
    voices.find((v) => v.lang.startsWith('en'));

  if (preferredEnVoice) {
    utterance.voice = preferredEnVoice;
    utterance.lang = preferredEnVoice.lang;
  } else {
    utterance.lang = 'en-US';
  }

  utterance.rate = 0.98;
  utterance.onend = () => {
    if (onEndCallback) onEndCallback();
  };
  utterance.onerror = () => {
    if (onEndCallback) onEndCallback();
  };

  window.speechSynthesis.speak(utterance);
}

function attachBotMessageContent(element, text) {
  element.innerHTML = `
    <div class="bot-sparkle" aria-hidden="true">✦</div>
    <div class="bot-content-wrap">
      <div class="bot-markdown-body">${renderMarkdown(text)}</div>
      <div class="msg-footer-tools">
        <button type="button" class="msg-tts-btn" title="Dengarkan pengucapan">
          🔊 Dengarkan
        </button>
      </div>
    </div>
  `;

  const ttsBtn = element.querySelector('.msg-tts-btn');
  if (ttsBtn) {
    ttsBtn.addEventListener('click', () => {
      if (window.speechSynthesis && window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        ttsBtn.textContent = '🔊 Dengarkan';
      } else {
        ttsBtn.textContent = '⏹️ Berhenti';
        speakTextBrowser(text, () => {
          ttsBtn.textContent = '🔊 Dengarkan';
        });
      }
    });
  }
}

function appendMessage(sender, text, isThinking = false) {
  const msgDiv = document.createElement('div');
  msgDiv.classList.add('message', sender);

  if (isThinking) {
    msgDiv.innerHTML = `
      <div class="bot-sparkle" aria-hidden="true">✦</div>
      <div class="bot-content-wrap">
        <div class="thinking-indicator">
          <div class="typing-dots"><span></span><span></span><span></span></div>
          <span>Thinking...</span>
        </div>
      </div>
    `;
  } else if (sender === 'bot') {
    attachBotMessageContent(msgDiv, text);
  } else {
    const inner = document.createElement('div');
    inner.className = 'user-bubble-inner';
    inner.textContent = text;
    msgDiv.appendChild(inner);
  }

  chatBox.appendChild(msgDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
  return msgDiv;
}

function getActiveSessionObj() {
  return (
    sessions.find((s) => s.id === progress.currentSession) ||
    sessions[0] || {
      id: 1,
      phase: 'Fase 1: Dasar (CEFR A1)',
      level: 'A1 - Beginner',
      title: 'Greetings, Introductions & Subject Pronouns',
      subtitle: 'Sapaan, Perkenalan Diri & Kata Ganti Subjek',
      summary: 'Belajar menyapa secara formal/informal, memperkenalkan diri, dan memahami kata ganti subjek.',
      practiceGoal: 'Membuat 3 kalimat perkenalan diri singkat dalam Bahasa Inggris.'
    }
  );
}

function updateUIForSession() {
  const active = getActiveSessionObj();
  const total = sessions.length || 16;
  const completedCount = progress.completedSessions.length;
  const pct = Math.min(100, Math.round((completedCount / total) * 100));

  progressCountText.textContent = `${completedCount} / ${total} Sesi Selesai`;
  progressBarFill.style.width = `${pct}%`;

  activeSessionHeaderText.textContent = `Sesi Aktif: Sesi ${active.id} (${active.level}) — ${active.title}`;
  bannerSessionBadge.textContent = `Sesi ${active.id} dari ${total} • ${active.level}`;
  bannerSessionTitle.textContent = `${active.title} (${active.subtitle})`;
  bannerSessionSummary.textContent = active.summary;
  bannerSessionGoal.textContent = active.practiceGoal;

  renderSidebarList();
}

function renderSidebarList() {
  sessionListEl.innerHTML = '';
  let lastPhase = '';

  sessions.forEach((s) => {
    if (s.phase !== lastPhase) {
      lastPhase = s.phase;
      const phaseEl = document.createElement('div');
      phaseEl.className = 'phase-label';
      phaseEl.textContent = s.phase;
      sessionListEl.appendChild(phaseEl);
    }

    const isDone = progress.completedSessions.includes(s.id);
    const isActive = s.id === progress.currentSession;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `session-item ${isActive ? 'active' : ''} ${isDone ? 'completed' : ''}`;
    btn.innerHTML = `
      <div class="session-num">${isDone ? '✓' : s.id}</div>
      <div class="session-item-info">
        <div class="session-item-title">${s.title}</div>
        <div class="session-item-sub">
          <span>${s.level}</span>
          ${isActive ? '<span class="badge-current">• Sesi Aktif</span>' : ''}
          ${!isActive && isDone ? '<span class="badge-done">• Selesai</span>' : ''}
        </div>
      </div>
    `;

    btn.addEventListener('click', () => {
      if (progress.currentSession !== s.id) {
        progress.currentSession = s.id;
        saveProgress();
        updateUIForSession();
        startSessionGreeting();
      }
      sidebar.classList.remove('open');
    });

    sessionListEl.appendChild(btn);
  });
}

function startSessionGreeting() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  chatBox.innerHTML = '';
  conversation = [];
  currentMode = 'auto';

  const active = getActiveSessionObj();
  const isCompleted = progress.completedSessions.includes(active.id);

  const greetingText = `Halo, aku **Lungo** ✦

Saat ini kamu berada di **Sesi ${active.id}: ${active.title}** *(${active.level})* ${isCompleted ? '✅' : ''}
> *${active.summary}*
> 🎯 **Target Sesi:** ${active.practiceGoal}

Mau mulai dari mana hari ini?
1. 📖 **Belajar Materi Sesi ${active.id}** — Penjelasan konsep, contoh kalimat, & latihan bertahap.
2. 💬 **Latihan Bercakap-cakap** — Ngobrol santai pakai Bahasa Inggris (teks atau klik **Live** di kanan atas untuk bicara langsung).
3. 📝 **Kuis Singkat Sesi ${active.id}** — Uji pemahamanmu di sesi ini.`;

  appendMessage('bot', greetingText);
  conversation.push({ role: 'model', text: greetingText });
}

async function sendUserMessage(messageText, modeOverride = null) {
  const trimmed = messageText.trim();
  if (!trimmed) return;

  if (modeOverride) {
    currentMode = modeOverride;
  }

  appendMessage('user', trimmed);
  conversation.push({ role: 'user', text: trimmed });

  const thinkingEl = appendMessage('bot', 'Thinking...', true);
  sendBtn.disabled = true;
  input.disabled = true;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        conversation,
        currentSession: progress.currentSession,
        mode: currentMode
      })
    });

    const data = await response.json();

    if (response.ok && data && data.result) {
      attachBotMessageContent(thinkingEl, data.result);
      conversation.push({ role: 'model', text: data.result });
    } else {
      const errMsg = data && data.error ? data.error : 'Sorry, no response received.';
      thinkingEl.innerHTML = renderMarkdown(`⚠️ **Info:** ${errMsg}`);
    }
  } catch (error) {
    console.error('Error fetching /api/chat:', error);
    thinkingEl.textContent = 'Failed to get response from server.';
  } finally {
    sendBtn.disabled = false;
    input.disabled = false;
    input.focus();
    chatBox.scrollTop = chatBox.scrollHeight;
  }
}

// ============================================================================
// === GEMINI 3.8 LIVE API (REAL-TIME BIDIRECTIONAL AUDIO OVER WEBSOCKETS) ====
// ============================================================================

function setLiveOrbState(state, titleText, subText = null) {
  liveOrb.className = `live-orb ${state}`;
  if (state === 'listening') {
    liveOrbIcon.textContent = '🎙️';
  } else if (state === 'thinking') {
    liveOrbIcon.textContent = '✨';
  } else if (state === 'speaking') {
    liveOrbIcon.textContent = '🔊';
  } else {
    liveOrbIcon.textContent = '⏸️';
  }
  if (titleText) liveStatusTitle.textContent = titleText;
  if (subText !== null) liveTranscriptText.textContent = subText;
}

function float32ToInt16(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToInt16Array(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

function ensurePlaybackAudioContext() {
  if (!playbackAudioCtx || playbackAudioCtx.state === 'closed') {
    playbackAudioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 24000
    });
    nextPlayTime = 0;
  }
  if (playbackAudioCtx.state === 'suspended') {
    playbackAudioCtx.resume();
  }
}

function playPcm24kChunk(base64Data) {
  ensurePlaybackAudioContext();
  const int16 = base64ToInt16Array(base64Data);
  if (int16.length === 0) return;

  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }

  const audioBuffer = playbackAudioCtx.createBuffer(1, float32.length, 24000);
  audioBuffer.getChannelData(0).set(float32);

  const source = playbackAudioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(playbackAudioCtx.destination);

  const currentTime = playbackAudioCtx.currentTime;
  if (nextPlayTime < currentTime) {
    nextPlayTime = currentTime + 0.02;
  }

  source.start(nextPlayTime);
  nextPlayTime += audioBuffer.duration;
  activeAudioSources.push(source);

  setLiveOrbState('speaking', 'Gemini Live sedang berbicara...');

  source.onended = () => {
    activeAudioSources = activeAudioSources.filter((s) => s !== source);
    if (activeAudioSources.length === 0 && isLiveSessionOpen && !isMicMutedInLive) {
      setLiveOrbState('listening', 'Mendengarkan kamu (Real-Time)...');
    }
  };
}

function clearPlaybackQueue() {
  activeAudioSources.forEach((src) => {
    try {
      src.stop();
    } catch (_) {}
  });
  activeAudioSources = [];
  if (playbackAudioCtx) {
    nextPlayTime = playbackAudioCtx.currentTime;
  }
}

async function startMicPcmStreaming() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    micAudioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000
    });
    const source = micAudioCtx.createMediaStreamSource(micStream);
    micProcessor = micAudioCtx.createScriptProcessor(2048, 1, 1);

    micProcessor.onaudioprocess = (e) => {
      if (!isLiveSessionOpen || isMicMutedInLive || !liveWs || liveWs.readyState !== WebSocket.OPEN) {
        return;
      }
      const inputFloat32 = e.inputBuffer.getChannelData(0);
      const pcm16 = float32ToInt16(inputFloat32);
      const base64Audio = arrayBufferToBase64(pcm16.buffer);

      // Kirim audio sesuai spesifikasi Gemini 3.8 Live API (realtimeInput.audio)
      liveWs.send(
        JSON.stringify({
          realtimeInput: {
            audio: {
              data: base64Audio,
              mimeType: 'audio/pcm;rate=16000'
            }
          }
        })
      );
    };

    source.connect(micProcessor);
    micProcessor.connect(micAudioCtx.destination);
  } catch (err) {
    console.error('Gagal mengakses mikrofon untuk Gemini Live:', err);
    setLiveOrbState(
      'paused',
      'Izin Mikrofon Ditolak / Gagal',
      'Pastikan Anda mengizinkan akses mikrofon di browser.'
    );
  }
}

function stopLiveVoiceSession() {
  isLiveSessionOpen = false;
  isMicMutedInLive = false;
  usingFallbackVoice = false;
  clearPlaybackQueue();

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  if (fallbackRec) {
    try {
      fallbackRec.onend = null;
      fallbackRec.abort();
    } catch (_) {}
    fallbackRec = null;
  }

  if (liveWs && liveWs.readyState === WebSocket.OPEN) {
    try {
      liveWs.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      liveWs.close();
    } catch (_) {}
  }
  liveWs = null;

  if (micProcessor) {
    try {
      micProcessor.disconnect();
    } catch (_) {}
    micProcessor = null;
  }
  if (micAudioCtx) {
    try {
      micAudioCtx.close();
    } catch (_) {}
    micAudioCtx = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
}

async function startGeminiLiveSession() {
  stopLiveVoiceSession();
  ensurePlaybackAudioContext();
  isLiveSessionOpen = true;
  currentInputTranscript = '';
  currentOutputTranscript = '';

  setLiveOrbState(
    'thinking',
    'Menghubungkan ke Gemini 3.8 Live...',
    'Menyiapkan saluran suara dua arah berlatensi rendah...'
  );

  try {
    const selectedVoice = voiceLangSelect.value || 'Aoede';
    const configRes = await fetch('/api/live-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentSession: progress.currentSession,
        voiceName: selectedVoice
      })
    });

    const liveConfig = await configRes.json();
    if (!configRes.ok || !liveConfig.wsUrl) {
      throw new Error(liveConfig.error || 'Gagal mendapatkan konfigurasi Live API');
    }

    liveWs = new WebSocket(liveConfig.wsUrl);

    liveWs.onopen = () => {
      // 1. Kirim pesan pertama BidiGenerateContentSetup sesuai spesifikasi Gemini 3.8 Live
      const setupMessage = {
        setup: {
          model: liveConfig.model,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: liveConfig.voiceName || 'Aoede'
                }
              }
            }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [{ text: liveConfig.systemInstruction }]
          }
        }
      };

      liveWs.send(JSON.stringify(setupMessage));
    };

    liveWs.onmessage = async (event) => {
      let rawData = event.data;
      if (rawData instanceof Blob) {
        rawData = await rawData.text();
      }
      const msg = JSON.parse(rawData);

      // Tunggu setupComplete sebelum mulai streaming mikrofon & sapaan awal
      if (msg.setupComplete !== undefined) {
        setLiveOrbState(
          'listening',
          'Terhubung! Silakan mulai bicara...',
          'Gemini 3.8 Live siap mendengarkan dan merespons secara real-time.'
        );
        await startMicPcmStreaming();

        // Minta Lungo menyapa singkat di awal sesi Live
        const active = getActiveSessionObj();
        liveWs.send(
          JSON.stringify({
            realtimeInput: {
              text: `Hi Lungo! Greet me briefly in English in 1-2 sentences and invite me to practice Session ${active.id}: ${active.title}.`
            }
          })
        );
        return;
      }

      const content = msg.serverContent;
      if (!content) return;

      // Jika pengguna menyela pembicaraan bot (Automatic Server VAD Interruption)
      if (content.interrupted === true) {
        clearPlaybackQueue();
        setLiveOrbState('listening', 'Mendengarkan kamu...');
      }

      // Proses semua bagian audio dari modelTurn
      if (content.modelTurn && Array.isArray(content.modelTurn.parts)) {
        for (const part of content.modelTurn.parts) {
          if (part.inlineData && part.inlineData.data) {
            playPcm24kChunk(part.inlineData.data);
          }
        }
      }

      // Tampilkan transkrip suara pengguna secara live
      if (content.inputTranscription && content.inputTranscription.text) {
        currentInputTranscript += content.inputTranscription.text;
        liveTranscriptText.textContent = `🗣️ Kamu: "${currentInputTranscript.trim()}"`;
      }

      // Tampilkan transkrip suara Gemini secara live
      if (content.outputTranscription && content.outputTranscription.text) {
        currentOutputTranscript += content.outputTranscription.text;
        liveTranscriptText.textContent = `✦ Lungo: "${currentOutputTranscript.trim()}"`;
      }

      // Ketika 1 giliran bicara selesai, catat ke dalam kotak chat utama
      if (content.turnComplete) {
        if (currentInputTranscript.trim()) {
          const userTxt = currentInputTranscript.trim();
          appendMessage('user', `🎙️ ${userTxt}`);
          conversation.push({ role: 'user', text: userTxt });
          currentInputTranscript = '';
        }
        if (currentOutputTranscript.trim()) {
          const botTxt = currentOutputTranscript.trim();
          appendMessage('bot', botTxt);
          conversation.push({ role: 'model', text: botTxt });
          currentOutputTranscript = '';
        }
      }
    };

    liveWs.onerror = (err) => {
      console.warn('Gemini Live WebSocket beralih ke Hybrid Fast Voice Mode:', err);
      startHybridVoiceFallback();
    };

    liveWs.onclose = (ev) => {
      if (isLiveSessionOpen && !usingFallbackVoice) {
        console.warn('WebSocket Live ditutup, beralih ke Hybrid Fast Voice Mode:', ev.reason);
        startHybridVoiceFallback();
      }
    };
  } catch (error) {
    console.warn('Beralih ke Hybrid Fast Voice Mode:', error);
    startHybridVoiceFallback();
  }
}

let usingFallbackVoice = false;
let fallbackRec = null;

function startHybridVoiceFallback() {
  if (!isLiveSessionOpen) return;
  usingFallbackVoice = true;

  if (!SpeechRecognition) {
    setLiveOrbState(
      'paused',
      'Browser Tidak Mendukung Mikrofon Suara',
      'Gunakan Google Chrome atau Microsoft Edge.'
    );
    return;
  }

  try {
    if (fallbackRec) {
      fallbackRec.onend = null;
      fallbackRec.abort();
    }
  } catch (_) {}

  fallbackRec = new SpeechRecognition();
  fallbackRec.lang = 'en-US';
  fallbackRec.interimResults = true;
  fallbackRec.continuous = false;

  let finalTranscript = '';

  fallbackRec.onstart = () => {
    setLiveOrbState(
      'listening',
      'Mendengarkan kamu...',
      'Mulai bicara Bahasa Inggris (contoh: "Hello Lungo, how are you today?")'
    );
  };

  fallbackRec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += t;
      } else {
        interim += t;
      }
    }
    liveTranscriptText.textContent = `🗣️ Kamu: "${(finalTranscript || interim).trim()}"`;
  };

  fallbackRec.onerror = (event) => {
    if (event.error === 'no-speech' && isLiveSessionOpen && !isMicMutedInLive) {
      setTimeout(() => {
        if (isLiveSessionOpen && !isMicMutedInLive) startHybridVoiceFallback();
      }, 300);
    }
  };

  fallbackRec.onend = async () => {
    if (!isLiveSessionOpen || isMicMutedInLive) return;
    const spoken = finalTranscript.trim();

    if (spoken) {
      setLiveOrbState('thinking', 'Lungo sedang menjawab...', `🗣️ Kamu: "${spoken}"`);
      appendMessage('user', `🎙️ ${spoken}`);
      conversation.push({ role: 'user', text: spoken });

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation,
            currentSession: progress.currentSession,
            mode: 'live-voice'
          })
        });
        const data = await res.json();

        if (res.ok && data && data.result) {
          appendMessage('bot', data.result);
          conversation.push({ role: 'model', text: data.result });
          const cleanReply = stripMarkdownForSpeech(data.result);
          setLiveOrbState('speaking', 'Lungo sedang berbicara...', `✦ ${cleanReply}`);

          speakTextBrowser(data.result, () => {
            if (isLiveSessionOpen && !isMicMutedInLive) {
              startHybridVoiceFallback();
            }
          });
        } else {
          setLiveOrbState('paused', 'Gagal Memuat Jawaban', data?.error || 'Terjadi kesalahan.');
        }
      } catch (err) {
        setLiveOrbState('paused', 'Gagal Terhubung ke Server', err.message);
      }
    } else {
      setTimeout(() => {
        if (isLiveSessionOpen && !isMicMutedInLive) startHybridVoiceFallback();
      }, 300);
    }
  };

  try {
    fallbackRec.start();
  } catch (_) {}
}

// Buka Modal Gemini Live
openLiveVoiceBtn.addEventListener('click', () => {
  liveVoiceOverlay.classList.remove('hidden');
  startGeminiLiveSession();
});

// Tutup Modal Gemini Live
closeLiveVoiceBtn.addEventListener('click', () => {
  stopLiveVoiceSession();
  liveVoiceOverlay.classList.add('hidden');
});

// Potong Suara Bot (Interrupt)
stopTtsBtn.addEventListener('click', () => {
  clearPlaybackQueue();
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  setLiveOrbState('listening', 'Mendengarkan kamu...');
  if (usingFallbackVoice && isLiveSessionOpen) {
    startHybridVoiceFallback();
  }
});

// Jeda / Lanjutkan Mikrofon di Live Voice
toggleLiveMicBtn.addEventListener('click', () => {
  if (usingFallbackVoice) {
    isMicMutedInLive = !isMicMutedInLive;
    if (isMicMutedInLive) {
      if (fallbackRec) {
        try {
          fallbackRec.onend = null;
          fallbackRec.abort();
        } catch (_) {}
      }
      toggleLiveMicBtn.textContent = '🔇 Lanjutkan Mic';
      setLiveOrbState('paused', 'Mikrofon Dijeda', 'Klik "🔇 Lanjutkan Mic" untuk berbicara lagi.');
    } else {
      toggleLiveMicBtn.textContent = '🎙️ Jeda / Bicara';
      startHybridVoiceFallback();
    }
    return;
  }

  if (!liveWs || liveWs.readyState !== WebSocket.OPEN) {
    startGeminiLiveSession();
    return;
  }
  isMicMutedInLive = !isMicMutedInLive;
  if (isMicMutedInLive) {
    liveWs.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    toggleLiveMicBtn.textContent = '🔇 Lanjutkan Mic';
    setLiveOrbState('paused', 'Mikrofon Dijeda', 'Klik "🔇 Lanjutkan Mic" untuk berbicara lagi.');
  } else {
    toggleLiveMicBtn.textContent = '🎙️ Jeda / Bicara';
    setLiveOrbState('listening', 'Mendengarkan kamu (Real-Time)...');
  }
});

// Ganti Suara AI di Live Voice
voiceLangSelect.addEventListener('change', () => {
  if (isLiveSessionOpen) {
    startGeminiLiveSession();
  }
});

// Tombol Mic di samping kolom input reguler (Voice-to-Text sekali klik)
micBtn.addEventListener('click', () => {
  if (!SpeechRecognition) {
    alert('Browser Anda belum mendukung fitur dikte suara. Gunakan Chrome atau Edge.');
    return;
  }

  if (isDictatingInput && dictRecognition) {
    dictRecognition.stop();
    return;
  }

  dictRecognition = new SpeechRecognition();
  dictRecognition.lang = 'en-US';
  dictRecognition.interimResults = true;
  isDictatingInput = true;
  micBtn.classList.add('recording');

  dictRecognition.onresult = (event) => {
    let text = '';
    for (let i = 0; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
    }
    input.value = text;
  };

  dictRecognition.onend = () => {
    isDictatingInput = false;
    micBtn.classList.remove('recording');
    input.focus();
  };

  dictRecognition.onerror = () => {
    isDictatingInput = false;
    micBtn.classList.remove('recording');
  };

  dictRecognition.start();
});

// Event Listener Submit Form Utama
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const userMessage = input.value.trim();
  if (!userMessage) return;
  input.value = '';
  await sendUserMessage(userMessage);
});

// Event Listener Tombol Aksi Cepat (Quick Chips)
quickActionsContainer.addEventListener('click', async (e) => {
  const btn = e.target.closest('.chip-btn');
  if (!btn || sendBtn.disabled) return;

  const action = btn.dataset.action;
  const active = getActiveSessionObj();

  if (action === 'study') {
    await sendUserMessage(
      `1. Aku mau belajar materi Sesi ${active.id} (${active.title}). Tolong jelaskan materinya secara bertahap dan berikan latihan singkat ya!`,
      'study'
    );
  } else if (action === 'chat') {
    await sendUserMessage(
      `2. Aku mau latihan bercakap-cakap (Speaking Practice) santai dalam Bahasa Inggris. Yuk mulai ajak aku ngobrol dan koreksi grammar-ku!`,
      'chat'
    );
  } else if (action === 'quiz') {
    await sendUserMessage(
      `3. Tolong berikan aku kuis interaktif singkat untuk menguji pemahamanku di Sesi ${active.id} (${active.title})!`,
      'quiz'
    );
  } else if (action === 'vocab') {
    await sendUserMessage(
      `Berikan daftar kosakata penting beserta contoh kalimat praktis untuk Sesi ${active.id} (${active.title})!`,
      'study'
    );
  }
});

// Tombol "Selesai & Lanjut Sesi"
completeSessionBtn.addEventListener('click', () => {
  const currentId = progress.currentSession;
  if (!progress.completedSessions.includes(currentId)) {
    progress.completedSessions.push(currentId);
  }

  const total = sessions.length || 16;
  if (currentId < total) {
    progress.currentSession = currentId + 1;
  }

  saveProgress();
  updateUIForSession();
  startSessionGreeting();
});

// Tombol "Mulai Ulang Sesi"
clearChatBtn.addEventListener('click', () => {
  startSessionGreeting();
});

// Tombol Reset Progres di Sidebar
resetProgressBtn.addEventListener('click', () => {
  if (confirm('Apakah kamu yakin ingin mengulang progres sesi dari Sesi 1?')) {
    progress = { currentSession: 1, completedSessions: [] };
    saveProgress();
    updateUIForSession();
    startSessionGreeting();
  }
});

// Toggle Sidebar untuk Desktop & Mobile ala Gemini
const appLayout = document.getElementById('app-layout');
openSidebarBtn.addEventListener('click', () => {
  if (window.innerWidth <= 860) {
    sidebar.classList.toggle('open');
  } else if (appLayout) {
    appLayout.classList.toggle('sidebar-collapsed');
  }
});
closeSidebarBtn.addEventListener('click', () => {
  sidebar.classList.remove('open');
  if (appLayout && window.innerWidth > 860) {
    appLayout.classList.add('sidebar-collapsed');
  }
});

// Inisialisasi aplikasi saat halaman dimuat
async function initApp() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
  }
  try {
    const res = await fetch('/api/curriculum');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.sessions)) {
        sessions = data.sessions;
      }
    }
  } catch (err) {
    console.warn('Menggunakan fallback kurikulum lokal:', err);
  }

  updateUIForSession();
  startSessionGreeting();
}

initApp();
