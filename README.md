# AI Audio Transcription and Summary

Record voice notes and meetings directly within Obsidian (macOS & iOS), transcribe them using OpenAI Whisper or Google Gemini with automatic size-chunking, and summarize/polish them using your LLM of choice (Anthropic Claude, OpenAI GPT, or Google Gemini).

Support me: https://ko-fi.com/hackerhomelab


[![Support on Ko-fi](https://img.shields.io/badge/Support%20on%20Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/hackerhomelab)


## 🚀 Key Features

*   **Direct Local Recording:** Record high-quality audio directly inside Obsidian. Includes support for selecting specific input devices (microphones) via settings.
*   **Dual-Provider Transcription:**
    *   **OpenAI Whisper:** Automatically chunks larger audio files at 22MB to safely stay under OpenAI's 25MB limit.
    *   **Google Gemini:** Transcribes using the latest stable Gemini API (e.g., `gemini-2.5-flash`), chunking at 10MB to respect inline payload boundaries.
*   **Intelligent Post-Processing:** Automatically cleans up transcripts using Anthropic (Claude), OpenAI (GPT), or Google (Gemini) based on your custom formatting instructions.
*   **Flexible Note Output:**
    *   Create a new Markdown file based on custom date/time templates and title generation.
    *   Or paste the transcription/summary directly at your current cursor position.
*   **Fail-Safe Resilience:** If any network error, invalid key, or deprecated model causes transcription or post-processing to fail, the plugin will *still* save the recorded audio file to your vault and create the note with the media player link so you never lose a recording.
*   **Premium Visuals:** Features dynamic visual wave bars, recording status blinking alerts, and time counters designed to integrate seamlessly with modern Obsidian themes.

---

## ⚙️ Configuration & Setup

1.  Enable the plugin under **Settings > Community Plugins**.
2.  Go to the **AI Audio Transcription & Summary** settings tab.
3.  Fill in your API Keys:
    *   **Gemini API Key:** Required if you use Google Gemini for transcription or post-processing.
    *   **Whisper API Key:** Required for OpenAI Whisper transcription.
    *   **OpenAI / Anthropic API Key:** Required if you use GPT or Claude for post-processing.
4.  Configure your **Transcription Provider** (OpenAI Whisper or Google Gemini) and select a recommended model from the dropdown.
5.  Set your output paths, file templates, and optional post-processing templates.

---

## 🛠️ Developer Commands

If you want to modify or compile the plugin yourself:

1.  Install dependencies:
    ```bash
    npm install
    ```
2.  Compile the production bundle:
    ```bash
    npm run build
    ```
    This compiles the TS source files into a single bundle file `main.js`.

---

## ☕ Support

If you find this plugin useful and want to support my work, you can buy me a coffee!

[![Support on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/hackerhomelab)

Your support helps me maintain the plugin and keep adding new features. Thank you!

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
