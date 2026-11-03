import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { CURRICULUM_SESSIONS, getSessionById } from './curriculum.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Daftar model dengan Auto-Fallback jika salah satu server model Google sedang sibuk (503 High Demand)
const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite'
];
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function buildSystemInstruction(currentSessionId = 1, mode = 'auto') {
  const activeSession = getSessionById(currentSessionId);

  return `
Anda adalah "Lungo", AI English Tutor & Speaking Partner profesional berstandar CEFR (Level A1 Dasar hingga C1 Persiapan IELTS/TOEFL).

=== 1. IDENTITAS & NADA BICARA ===
- Nama Anda: Lungo.
- Ramah, sabar, suportif, dan praktis.
- Gunakan Bahasa Indonesia yang jelas saat menjelaskan konsep/rumus grammar atau memberi feedback.
- Gunakan Bahasa Inggris natural saat latihan percakapan.

=== 2. BATASAN TEGAS (GUARDRAILS) ===
- HANYA layani pembelajaran Bahasa Inggris (Grammar, Vocabulary, Speaking, Reading, Writing, TOEFL/IELTS).
- TOLAK DENGAN SOPAN pertanyaan di luar topik Bahasa Inggris (coding, resep masakan, matematika, medis, politik, dll) dan arahkan kembali ke latihan Bahasa Inggris bersama Lungo.

=== 3. KONTEKS SESI AKTIF PENGGUNA ===
- Sesi Aktif: Sesi ${activeSession.id} dari ${CURRICULUM_SESSIONS.length} (${activeSession.phase} — ${activeSession.level})
- Materi: ${activeSession.title} (${activeSession.subtitle})
- Ringkasan: ${activeSession.summary}
- Poin Kunci:
  ${activeSession.keyPoints.map((kp, i) => `${i + 1}. ${kp}`).join('\n  ')}
- Target Praktik: ${activeSession.practiceGoal}
- Mode Interaksi: ${mode}

=== 4. ATURAN RESPONS (RINGKAS & CEPAT) ===
- Jika mode = "study": Jelaskan konsep Sesi ${activeSession.id} secara padat dan mudah dipahami, beri 3 contoh kalimat beserta artinya, lalu berikan 1-2 soal latihan singkat sesuai Target Praktik.
- Jika mode = "chat": Ajak ngobrol santai dalam Bahasa Inggris, berikan bagian "💡 Grammar & Vocab Polish:" jika ada kalimat pengguna yang kurang tepat, dan akhiri dengan 1 pertanyaan balik.
- Jika mode = "quiz": Berikan 2-3 soal latihan singkat seputar Sesi ${activeSession.id} untuk dijawab pengguna.
- Jika mode = "live-voice": Pengguna sedang berbicara langsung menggunakan suara. Buat jawaban yang SANGAT RINGKAS dan enak didengar saat diucapkan (2-3 kalimat saja), tanpa simbol Markdown berlebihan, selipkan koreksi singkat secara lisan bila perlu, dan tutup dengan 1 pertanyaan pendek dalam Bahasa Inggris.
`.trim();
}

async function generateWithFallback(ai, contents, systemInstruction) {
  let lastError = null;

  for (const modelName of MODEL_CANDIDATES) {
    try {
      const config = {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        systemInstruction
      };

      // Atur thinkingLevel terendah yang didukung masing-masing model agar super cepat
      if (modelName.includes('3.8')) {
        config.thinkingConfig = { thinkingLevel: 'low' };
      } else if (modelName.includes('3.5') || modelName.includes('3.6')) {
        config.thinkingConfig = { thinkingLevel: 'minimal' };
      }

      const response = await ai.models.generateContent({
        model: modelName,
        contents,
        config
      });

      return response;
    } catch (err) {
      lastError = err;
      const errMsg = String(err?.message || '');
      const isRetryable =
        errMsg.includes('503') ||
        errMsg.includes('UNAVAILABLE') ||
        errMsg.includes('high demand') ||
        errMsg.includes('429') ||
        errMsg.includes('404');

      console.warn(`⚠️ Model ${modelName} sedang sibuk/tidak tersedia, mencoba model cadangan...`);
      if (!isRetryable) {
        break;
      }
    }
  }

  throw lastError;
}

// Endpoint untuk mengambil daftar kurikulum 16 sesi (digunakan oleh Frontend UI)
app.get('/api/curriculum', (req, res) => {
  res.status(200).json({
    totalSessions: CURRICULUM_SESSIONS.length,
    sessions: CURRICULUM_SESSIONS
  });
});

// Endpoint konfigurasi WebSocket untuk Gemini Live API (gemini-3.8-live)
app.post('/api/live-config', async (req, res) => {
  const { currentSession = 1, voiceName = 'Aoede' } = req.body || {};
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    return res.status(500).json({
      error: 'GEMINI_API_KEY belum diatur di dalam file .env'
    });
  }

  const systemInstructionText = buildSystemInstruction(currentSession, 'live-voice');

  try {
    const client = new GoogleGenAI({ apiKey, apiVersion: 'v1alpha' });
    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime
      }
    });

    if (token && token.name) {
      return res.status(200).json({
        wsUrl: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token.name)}`,
        model: `models/${GEMINI_LIVE_MODEL}`,
        voiceName,
        systemInstruction: systemInstructionText
      });
    }
  } catch (err) {
    console.log('Menggunakan koneksi WebSocket Live API langsung (local dev):', err.message);
  }

  return res.status(200).json({
    wsUrl: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`,
    model: `models/${GEMINI_LIVE_MODEL}`,
    voiceName,
    systemInstruction: systemInstructionText
  });
});

// Endpoint utama sesuai spesifikasi Sesi 3 Hacktiv8: POST /api/chat
app.post('/api/chat', async (req, res) => {
  const { conversation, currentSession = 1, mode = 'auto' } = req.body;

  try {
    if (!Array.isArray(conversation)) {
      return res.status(400).json({
        error: 'Invalid conversation format. Expected an array of messages.'
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      return res.status(500).json({
        error:
          'GEMINI_API_KEY belum diatur. Silakan masukkan API Key Anda dari Google AI Studio ke dalam file .env'
      });
    }

    const ai = new GoogleGenAI({ apiKey });

    const contents = conversation.map(({ role, text }) => ({
      role: role === 'model' || role === 'bot' ? 'model' : 'user',
      parts: [{ text: String(text ?? '') }]
    }));

    const response = await generateWithFallback(
      ai,
      contents,
      buildSystemInstruction(currentSession, mode)
    );

    res.status(200).json({ result: response.text });
  } catch (error) {
    console.error('Error in POST /api/chat:', error);
    res.status(500).json({
      error: error.message || 'Failed to generate response from Gemini AI'
    });
  }
});

const PORT = process.env.PORT || 3000;

if (!process.env.VERCEL) {
  app.listen(PORT, (err) => {
    if (err) {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `⚠️ Port ${PORT} masih dipakai oleh proses server lama! Matikan terminal lama atau jalankan: taskkill /F /IM node.exe`
        );
      } else {
        console.error('Gagal menjalankan server:', err);
      }
      process.exit(1);
    }
    console.log(
      `✅ Server Lungo aktif di http://localhost:${PORT} (Model Utama: ${MODEL_CANDIDATES[0]} + Auto-Fallback)`
    );
  });
}

export default app;
