import { requestUrl, RequestUrlParam } from 'obsidian';
import { WhisperAudioSettings } from './settings';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return window.btoa(binary);
}

export class UnifiedApiClient {
  constructor(private settings: WhisperAudioSettings) {}

  /**
   * Helper to resolve the correct Whisper API endpoint with robust path checking
   */
  private getWhisperUrl(): string {
    let endpoint = this.settings.apiUrl.trim();
    // Strip trailing slashes
    endpoint = endpoint.replace(/\/+$/, '');
    
    // If it doesn't already contain '/audio/transcriptions' as a path segment, append it
    if (!endpoint.includes('/audio/transcriptions')) {
      endpoint = endpoint + '/audio/transcriptions';
    }
    return endpoint;
  }

  /**
   * Helper to manually build a multipart/form-data payload for requestUrl
   */
  private buildMultipartBody(
    fileBuffer: ArrayBuffer,
    fileName: string,
    mimeType: string,
    fields: Record<string, string>
  ): { body: ArrayBuffer; contentType: string } {
    const boundary = '----ObsidianBoundary' + Math.random().toString(36).substring(2);
    const enc = new TextEncoder();
    const parts: ArrayBuffer[] = [];

    // Add fields
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null || value === '') continue;
      const fieldHeader = `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`;
      parts.push(enc.encode(fieldHeader).buffer);
    }

    // Add file
    const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
    parts.push(enc.encode(fileHeader).buffer);
    parts.push(fileBuffer);
    
    // Add closing boundary
    const closing = `\r\n--${boundary}--\r\n`;
    parts.push(enc.encode(closing).buffer);

    // Merge parts
    const totalLength = parts.reduce((acc, part) => acc + part.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      combined.set(new Uint8Array(part), offset);
      offset += part.byteLength;
    }

    return {
      body: combined.buffer,
      contentType: `multipart/form-data; boundary=${boundary}`
    };
  }

  /**
   * Transcribe a single audio chunk via Whisper
   */
  async transcribeChunk(fileBuffer: ArrayBuffer, mimeType: string, index: number): Promise<string> {
    const whisperKey = this.settings.whisperApiKey;
    if (!whisperKey) {
      throw new Error('Whisper API key is missing.');
    }

    const endpoint = this.getWhisperUrl();
    
    // Resolve correct file extension from MIME type to prevent API format-mismatch errors
    const ext = mimeType.includes('webm') ? 'webm' :
                mimeType.includes('ogg') ? 'ogg' :
                mimeType.includes('mp4') || mimeType.includes('aac') ? 'm4a' :
                mimeType.includes('mpeg') ? 'mp3' : 'webm';
                
    const fileName = `chunk-${index}-${Date.now()}.${ext}`;

    const fields: Record<string, string> = {
      model: this.settings.model,
      temperature: this.settings.temperature.toString(),
      response_format: this.settings.responseFormat
    };

    if (this.settings.language) {
      fields.language = this.settings.language;
    }
    if (this.settings.prompt) {
      fields.prompt = this.settings.prompt;
    }

    const { body, contentType } = this.buildMultipartBody(fileBuffer, fileName, mimeType, fields);

    const params: RequestUrlParam = {
      url: endpoint,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${whisperKey}`,
        'Content-Type': contentType
      },
      body: body
    };

    if (this.settings.debugMode) {
      console.log(`[Whisper Debug] Sending chunk ${index + 1} to ${endpoint} with filename ${fileName} (MIME: ${mimeType})`);
    }

    try {
      const response = await requestUrl(params);

      if (response.status !== 200) {
        throw new Error(`Status ${response.status}: ${response.text}`);
      }

      // Attempt to parse response based on configuration format
      if (this.settings.responseFormat.includes('json')) {
        const json = response.json;
        if (json && json.text !== undefined) {
          return json.text;
        }
      }
      return response.text.trim();
    } catch (error) {
      const errMessage = (error as Error).message || JSON.stringify(error);
      throw new Error(`Whisper Transcription failed for model '${this.settings.model}' at URL '${endpoint}'. Details: ${errMessage}`);
    }
  }

  /**
   * Transcribe a single audio chunk via Google Gemini API (inlineData)
   */
  async transcribeGemini(fileBuffer: ArrayBuffer, mimeType: string, index: number): Promise<string> {
    const apiKey = this.settings.geminiApiKey;
    if (!apiKey) {
      throw new Error('Gemini API key is missing. Required for Gemini audio transcription.');
    }

    const base64Data = arrayBufferToBase64(fileBuffer);
    const model = this.settings.geminiTranscriptionModel || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const promptText = "Please transcribe this audio verbatim. Keep all speaker dialog, fix no spelling, and return only the transcript content, nothing else.";

    const params: RequestUrlParam = {
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: promptText
              },
              {
                inlineData: {
                  mimeType: mimeType || 'audio/webm',
                  data: base64Data
                }
              }
            ]
          }
        ]
      })
    };

    if (this.settings.debugMode) {
      console.log(`[Gemini Debug] Transcribing chunk ${index + 1} via Gemini Model ${model} (MIME: ${mimeType})`);
    }

    try {
      const response = await requestUrl(params);
      if (response.status !== 200) {
        throw new Error(`Status ${response.status}: ${response.text}`);
      }

      const json = response.json;
      if (
        json &&
        json.candidates &&
        json.candidates[0] &&
        json.candidates[0].content &&
        json.candidates[0].content.parts &&
        json.candidates[0].content.parts[0] &&
        json.candidates[0].content.parts[0].text
      ) {
        return json.candidates[0].content.parts[0].text.trim();
      }
      throw new Error('Unexpected response format from Gemini API during transcription');
    } catch (error) {
      const errMessage = (error as Error).message || JSON.stringify(error);
      throw new Error(`Gemini transcription failed for model '${model}'. Details: ${errMessage}`);
    }
  }

  /**
   * Post-process a transcribed string using the selected LLM provider
   */
  async postProcess(text: string, prompt: string): Promise<string> {
    const provider = this.settings.postProcessingProvider;
    
    if (this.settings.debugMode) {
      console.log(`[Whisper Debug] Post-processing transcript with ${provider} using model ${this.settings.postProcessingModel}`);
    }

    switch (provider) {
      case 'anthropic':
        return this.callAnthropic(text, prompt);
      case 'openai':
        return this.callOpenAI(text, prompt);
      case 'gemini':
        return this.callGemini(text, prompt);
      default:
        throw new Error(`Unknown post-processing provider: ${provider}`);
    }
  }

  /**
   * Generate a title from the transcript
   */
  async generateTitle(text: string): Promise<string> {
    const titlePrompt = this.settings.titlePrompt || 'Generate a short title (1-5 words) for the following text. Return only the title, nothing else.';
    try {
      const generated = await this.postProcess(text, titlePrompt);
      // Clean up quotes and trailing punctuation
      return generated.replace(/["'’.]/g, '').trim();
    } catch (e) {
      console.warn('Failed to generate title, using fallback', e);
      return '';
    }
  }

  private async callAnthropic(text: string, systemPrompt: string): Promise<string> {
    const apiKey = this.settings.anthropicApiKey;
    if (!apiKey) {
      throw new Error('Anthropic API key is missing.');
    }

    const url = 'https://api.anthropic.com/v1/messages';
    const params: RequestUrlParam = {
      url,
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: this.settings.postProcessingModel || 'claude-3-5-haiku-20241022',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `${systemPrompt}\n\nTranscription:\n${text}`
          }
        ]
      })
    };

    try {
      const response = await requestUrl(params);
      if (response.status !== 200) {
        throw new Error(`Status ${response.status}: ${response.text}`);
      }

      const json = response.json;
      if (json && json.content && json.content[0] && json.content[0].text) {
        return json.content[0].text.trim();
      }
      throw new Error('Unexpected response format from Anthropic API');
    } catch (error) {
      const errMessage = (error as Error).message || JSON.stringify(error);
      throw new Error(`Anthropic post-processing failed for model '${this.settings.postProcessingModel}' at URL '${url}'. Details: ${errMessage}`);
    }
  }

  private async callOpenAI(text: string, systemPrompt: string): Promise<string> {
    const apiKey = this.settings.openaiApiKey;
    if (!apiKey) {
      throw new Error('OpenAI API key is missing.');
    }

    const url = 'https://api.openai.com/v1/chat/completions';
    const params: RequestUrlParam = {
      url,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.settings.postProcessingModel || 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: `${systemPrompt}\n\nTranscription:\n${text}`
          }
        ]
      })
    };

    try {
      const response = await requestUrl(params);
      if (response.status !== 200) {
        throw new Error(`Status ${response.status}: ${response.text}`);
      }

      const json = response.json;
      if (json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) {
        return json.choices[0].message.content.trim();
      }
      throw new Error('Unexpected response format from OpenAI API');
    } catch (error) {
      const errMessage = (error as Error).message || JSON.stringify(error);
      throw new Error(`OpenAI post-processing failed for model '${this.settings.postProcessingModel}' at URL '${url}'. Details: ${errMessage}`);
    }
  }

  private async callGemini(text: string, systemPrompt: string): Promise<string> {
    const apiKey = this.settings.geminiApiKey;
    if (!apiKey) {
      throw new Error('Gemini API key is missing.');
    }

    const model = this.settings.postProcessingModel || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const params: RequestUrlParam = {
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `${systemPrompt}\n\nTranscription:\n${text}`
              }
            ]
          }
        ]
      })
    };

    try {
      const response = await requestUrl(params);
      if (response.status !== 200) {
        throw new Error(`Status ${response.status}: ${response.text}`);
      }

      const json = response.json;
      if (
        json &&
        json.candidates &&
        json.candidates[0] &&
        json.candidates[0].content &&
        json.candidates[0].content.parts &&
        json.candidates[0].content.parts[0] &&
        json.candidates[0].content.parts[0].text
      ) {
        return json.candidates[0].content.parts[0].text.trim();
      }
      throw new Error('Unexpected response format from Gemini API');
    } catch (error) {
      const errMessage = (error as Error).message || JSON.stringify(error);
      throw new Error(`Gemini post-processing failed for model '${model}' at URL '${url}'. Details: ${errMessage}`);
    }
  }
}
