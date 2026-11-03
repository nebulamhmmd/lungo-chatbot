# ✦ Lungo — AI English Tutor & Speaking Partner (`gemini-chatbot-api`)

Aplikasi web Chatbot pintar berbasis **Google Gemini AI API (`@google/genai`)**, **Node.js + Express**, dan **Vanilla JavaScript** dengan desain minimalis ala Google Gemini untuk membantu pengguna belajar Bahasa Inggris secara bertahap dari tingkat dasar (**CEFR A1**) hingga persiapan ujian **TOEFL & IELTS (CEFR C1)**.

---

## ✨ Fitur Utama

1. **Sistem Sesi Belajar Bertahap (Session-Based Progress, Bukan Harian)**
   - Kurikulum terdiri dari **16 Sesi Terstruktur** dalam **5 Fase** (A1 Beginner, A2 Elementary, B1 Intermediate, B2 Upper-Intermediate, hingga C1 Persiapan TOEFL & IELTS).
   - Progres disimpan berdasarkan sesi di `localStorage`. Jika hari ini pengguna libur/tidak belajar, keesokan harinya materi tetap berada di sesi terakhir yang belum diselesaikan (tidak melompat otomatis).
2. **2 Mode Interaksi di Setiap Sesi + Gemini Live Voice**
   - **📖 Mode Belajar Materi:** Lungo menjelaskan konsep/rumus sesi aktif secara ringkas, memberikan contoh kalimat nyata, dan memberikan latihan/kuis singkat.
   - **💬 Mode Bercakap-cakap (*Speaking Partner*):** Lungo mengajak mengobrol santai dalam Bahasa Inggris sekaligus memberikan **💡 Grammar & Vocab Polish** (koreksi halus & alternatif kalimat natural) di setiap balasan.
   - **🎙️ Mode Suara (*Live Voice*):** Percakapan suara dua arah secara *real-time* seperti Gemini Live.
3. **Konfigurasi Gemini AI & Guardrails Ketat (`systemInstruction`)**
   - Menggunakan parameter `temperature`, `topP`, `topK`, dan `systemInstruction` dinamis sesuai sesi aktif.
   - Menolak dengan sopan segala pertanyaan di luar pembelajaran Bahasa Inggris.

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js, `@google/genai`, `dotenv`, `cors`
- **Frontend:** HTML5, Modern CSS3, Vanilla JavaScript (`fetch` API), `marked` & `DOMPurify` (untuk merender Markdown dengan aman)

---

## 🚀 Cara Menjalankan Proyek

1. **Instal Dependensi**
   ```bash
   npm install
   ```

2. **Konfigurasi Environment Variable (`.env`)**
   Buka file `.env` dan masukkan API Key Gemini Anda dari [Google AI Studio](https://aistudio.google.com/app/apikey):
   ```env
   GEMINI_API_KEY=AIzaSyYourActualGeminiApiKeyHere
   PORT=3000
   ```

3. **Jalankan Server**
   ```bash
   node index.js
   ```

4. **Buka di Browser**
   Kunjungi `http://localhost:3000`
