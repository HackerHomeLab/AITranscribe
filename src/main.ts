import { App, Plugin, Modal, Notice, TFile, Setting, MarkdownView } from 'obsidian';
import { AudioRecorder, RecorderResult } from './recorder';
import { UnifiedApiClient } from './api';
import { WhisperAudioSettings, DEFAULT_SETTINGS, WhisperAudioSettingTab } from './settings';

export default class WhisperAudioPlugin extends Plugin {
  settings!: WhisperAudioSettings;
  recorder!: AudioRecorder;
  statusBarItem: HTMLElement | null = null;
  activeModal: RecorderModal | null = null;

  async onload() {
    await this.loadSettings();

    this.recorder = new AudioRecorder(this.app);

    // Add status bar item
    this.statusBarItem = this.addStatusBarItem();
    this.updateStatusBar(0, false);

    // Setup recorder event listeners
    this.recorder.onTick = (duration) => {
      this.updateStatusBar(duration, true);
      if (this.activeModal) {
        this.activeModal.updateTimer(duration);
      }
    };

    this.recorder.onStateChange = (state) => {
      if (!state.isRecording) {
        this.updateStatusBar(0, false);
      }
      if (this.activeModal) {
        this.activeModal.updateControls();
      }
    };

    // Add ribbon icon (sidebar trigger)
    this.addRibbonIcon('microphone', 'AI Audio Transcription and Summary', () => {
      this.openRecorderModal();
    });

    // Add command to open recorder controls
    this.addCommand({
      id: 'open-recorder',
      name: 'Open AI Recorder Controls',
      callback: () => this.openRecorderModal()
    });

    // Add command to toggle recording directly
    this.addCommand({
      id: 'start-recording',
      name: 'Start Audio Recording',
      checkCallback: (checking) => {
        if (!this.recorder.isRecording) {
          if (!checking) {
            const maxChunkSize = this.settings.transcriptionProvider === 'gemini'
              ? 10 * 1024 * 1024 // 10MB limit for Gemini inline base64 requests
              : 22 * 1024 * 1024; // 22MB limit for Whisper
            this.recorder.start(this.settings.selectedMic, maxChunkSize).then(() => {
              new Notice('Audio recording started...');
            }).catch(err => {
              new Notice('Failed to start recording: ' + err.message);
            });
          }
          return true;
        }
        return false;
      }
    });

    this.addCommand({
      id: 'stop-recording',
      name: 'Stop and Process Audio',
      checkCallback: (checking) => {
        if (this.recorder.isRecording) {
          if (!checking) {
            this.handleStopAndProcess();
          }
          return true;
        }
        return false;
      }
    });

    // Register settings tab
    this.addSettingTab(new WhisperAudioSettingTab(this.app, this));
  }

  onunload() {
    if (this.recorder.isRecording) {
      this.recorder.cancel();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    
    // Automatically migrate retired Gemini models to their modern 2.5 equivalents
    let needsMigration = false;
    if (this.settings.geminiTranscriptionModel === 'gemini-1.5-flash' || this.settings.geminiTranscriptionModel === 'gemini-2.0-flash') {
      this.settings.geminiTranscriptionModel = 'gemini-2.5-flash';
      needsMigration = true;
    } else if (this.settings.geminiTranscriptionModel === 'gemini-1.5-pro') {
      this.settings.geminiTranscriptionModel = 'gemini-2.5-pro';
      needsMigration = true;
    }

    if (this.settings.postProcessingModel === 'gemini-1.5-flash' || this.settings.postProcessingModel === 'gemini-2.0-flash') {
      this.settings.postProcessingModel = 'gemini-2.5-flash';
      needsMigration = true;
    } else if (this.settings.postProcessingModel === 'gemini-1.5-pro') {
      this.settings.postProcessingModel = 'gemini-2.5-pro';
      needsMigration = true;
    }
    
    // Whisper settings model field migration (if user typed gemini in there previously)
    if (this.settings.model === 'gemini-1.5-flash' || this.settings.model === 'gemini-2.0-flash') {
      this.settings.model = 'gemini-2.5-flash';
      needsMigration = true;
    } else if (this.settings.model === 'gemini-1.5-pro') {
      this.settings.model = 'gemini-2.5-pro';
      needsMigration = true;
    }

    if (needsMigration) {
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  openRecorderModal() {
    if (this.activeModal) {
      this.activeModal.open();
      return;
    }
    this.activeModal = new RecorderModal(this.app, this);
    this.activeModal.onClose = () => {
      this.activeModal = null;
    };
    this.activeModal.open();
  }

  updateStatusBar(seconds: number, isRecording: boolean) {
    if (!this.statusBarItem) return;

    if (isRecording) {
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      const timeStr = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      this.statusBarItem.setText(`🎙️ Recording: ${timeStr}`);
      this.statusBarItem.className = 'gemini-status-bar-recording';
      
      // Make clickable to restore modal
      this.statusBarItem.onclick = () => this.openRecorderModal();
    } else {
      this.statusBarItem.setText('');
      this.statusBarItem.className = '';
      this.statusBarItem.onclick = null;
    }
  }

  async handleStopAndProcess() {
    // 1. Verify credentials and prompt if keys are missing
    let needsWhisperKey = (this.settings.transcriptionProvider === 'openai') && !this.settings.whisperApiKey;
    let needsGeminiKey = (this.settings.transcriptionProvider === 'gemini' || this.settings.postProcessingProvider === 'gemini') && !this.settings.geminiApiKey;
    let needsProviderKey = false;
    let providerName = '';

    if (this.settings.enablePostProcessing) {
      const provider = this.settings.postProcessingProvider;
      if (provider === 'anthropic' && !this.settings.anthropicApiKey) {
        needsProviderKey = true;
        providerName = 'anthropic';
      } else if (provider === 'openai' && !this.settings.openaiApiKey) {
        needsProviderKey = true;
        providerName = 'openai';
      } else if (provider === 'gemini' && !this.settings.geminiApiKey) {
        needsGeminiKey = true; // Handled under needsGeminiKey validation
      }
    }

    if (needsWhisperKey || needsGeminiKey || needsProviderKey) {
      const promptModal = new ApiKeyPromptModal(this.app, this, needsWhisperKey, needsGeminiKey, providerName);
      promptModal.open();
      const confirmed = await promptModal.promise();
      if (!confirmed) {
        new Notice('Processing cancelled due to missing API keys.');
        this.recorder.cancel();
        return;
      }
    }

    const notice = new Notice('Finalizing recording...', 0);
    try {
      const result = await this.recorder.stop(this.settings.audioFolder, this.settings.saveAudioFile);
      
      if (this.settings.saveAudioFile) {
        const filePaths = result.files.map(f => f.path).join(', ');
        new Notice(`Audio saved locally: ${filePaths}`);
      }

      await this.processRecordedChunks(result, notice);
    } catch (error) {
      console.error(error);
      new Notice('Recording stop failed: ' + (error as Error).message);
      notice.hide();
    }
  }

  async processRecordedChunks(result: RecorderResult, notice: Notice) {
    try {
      const client = new UnifiedApiClient(this.settings);
      let fullTranscription = '';
      let transcriptionErrors: string[] = [];

      // Transcribe each chunk independently via the selected provider
      for (let i = 0; i < result.blobs.length; i++) {
        const blob = result.blobs[i];
        
        // Skip empty/tiny chunks (< 1KB) to prevent format/size errors
        if (blob.size < 1024) {
          if (this.settings.debugMode) {
            console.log(`[Transcription Debug] Skipping chunk ${i + 1} because size is too small (${blob.size} bytes).`);
          }
          continue;
        }

        try {
          const arrayBuffer = await blob.arrayBuffer();
          notice.setMessage(`Transcribing audio part ${i + 1} of ${result.blobs.length} using ${this.settings.transcriptionProvider}...`);
          
          let textSegment = '';
          if (this.settings.transcriptionProvider === 'gemini') {
            textSegment = await client.transcribeGemini(arrayBuffer, result.mimeType, i);
          } else {
            textSegment = await client.transcribeChunk(arrayBuffer, result.mimeType, i);
          }
          
          if (textSegment && textSegment.trim()) {
            fullTranscription += (fullTranscription ? ' ' : '') + textSegment.trim();
          }
        } catch (err) {
          const errMsg = (err as Error).message || String(err);
          console.error(`Failed to transcribe chunk ${i + 1}:`, err);
          transcriptionErrors.push(`Part ${i + 1}: ${errMsg}`);
          new Notice(`Warning: Failed to transcribe audio part ${i + 1}. Skipping this segment.`, 5000);
        }
      }

      // Handle complete transcription failure
      if (!fullTranscription.trim()) {
        const errorText = transcriptionErrors.length > 0
          ? `Transcription failed:\n${transcriptionErrors.map(e => `- ${e}`).join('\n')}`
          : 'All audio chunks were empty or too small to transcribe.';
        
        if (this.settings.createNoteFile) {
          notice.setMessage('Creating fallback note...');
          const fallbackContent = `> [!WARNING] Transcription Failed\n` +
            `> ${errorText.replace(/\n/g, '\n> ')}\n\n` +
            `The audio recording has been saved to your vault.\n\n` +
            (result.files.length > 0 ? result.files.map(f => `![[${f.path}]]`).join('\n') : '');
          
          await this.createMeetingNote(result, '', '', fallbackContent, 'Failed Transcription');
          new Notice('Transcription failed, but your audio file was saved and linked in a new note.', 10000);
        } else {
          new Notice(`Error: ${errorText}`, 10000);
        }
        return;
      }

      let finalOutput = fullTranscription;
      let polishedText = '';

      // Run post-processing LLM if configured
      if (this.settings.enablePostProcessing && fullTranscription.trim()) {
        notice.setMessage(`Cleaning up transcription using ${this.settings.postProcessingProvider}...`);
        try {
          polishedText = await client.postProcess(fullTranscription, this.settings.postProcessingPrompt);
          
          if (this.settings.keepOriginalTranscription) {
            finalOutput = `${polishedText}\n\n### Original Transcript\n${fullTranscription}`;
          } else {
            finalOutput = polishedText;
          }
        } catch (err) {
          const ppError = (err as Error).message || String(err);
          console.error('Post-processing failed:', err);
          new Notice(`Warning: Post-processing failed. Using raw transcription.`, 8000);
          finalOutput = `> [!WARNING] Post-processing Failed\n> ${ppError.replace(/\n/g, '\n> ')}\n\n${fullTranscription}`;
        }
      }

      // If there were partial transcription failures, prepend them to final output
      if (transcriptionErrors.length > 0) {
        finalOutput = `> [!WARNING] Some audio parts failed to transcribe:\n` +
          transcriptionErrors.map(e => `> - ${e}`).join('\n') + `\n\n` + finalOutput;
      }

      // Route Output: Cursor insertion or Note creation
      if (this.settings.createNoteFile) {
        notice.setMessage('Creating new note file...');
        
        // Generate title if enabled
        let title = '';
        if (this.settings.enablePostProcessing && this.settings.autoGenerateTitle && fullTranscription.trim()) {
          notice.setMessage('Generating note title...');
          try {
            title = await client.generateTitle(polishedText || fullTranscription);
          } catch (err) {
            console.error('Title generation failed:', err);
          }
        }
        
        await this.createMeetingNote(result, fullTranscription, polishedText, finalOutput, title);
      } else {
        // Insert directly at active cursor
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView && activeView.editor) {
          activeView.editor.replaceSelection(finalOutput);
          new Notice('Transcription pasted at cursor.');
        } else {
          new Notice('Error: No active Markdown editor found to paste transcription.');
        }
      }
    } catch (error) {
      console.error(error);
      new Notice('API processing failed: ' + (error as Error).message, 10000);
    } finally {
      notice.hide();
    }
  }

  async createMeetingNote(
    result: RecorderResult,
    rawTranscript: string,
    polishedTranscript: string,
    processedOutput: string,
    generatedTitle: string
  ) {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-');
    const datetimeStr = `${dateStr} ${date.toTimeString().split(' ')[0]}`;
    
    const titleVal = generatedTitle.trim() || `Meeting-${dateStr}-${timeStr}`;

    let noteTemplate = this.settings.noteTemplate;

    // Smart replace for audioFile based on user brackets to avoid double/extra brackets
    const audioFileRegex = /(!?\s*\[+\s*)?\{\{audioFile\}\}(\s*\]+\s*)?/g;
    if (this.settings.saveAudioFile && result.files.length > 0) {
      noteTemplate = noteTemplate.replace(audioFileRegex, (match, prefix, suffix) => {
        if (prefix && prefix.trim().startsWith('!')) {
          return result.files.map(f => `![[${f.path}]]`).join('\n');
        } else if (prefix) {
          return result.files.map(f => `[[${f.path}]]`).join('\n');
        } else {
          return result.files.map(f => f.path).join('\n');
        }
      });
    } else {
      // Clean up the template placeholder if no audio file is saved
      noteTemplate = noteTemplate.replace(audioFileRegex, '');
    }

    const templateVariables: Record<string, string> = {
      transcription: processedOutput,
      date: dateStr,
      time: date.toTimeString().split(' ')[0],
      datetime: datetimeStr,
      title: titleVal
    };

    // Apply template substitutions
    const noteContent = this.resolveTemplate(noteTemplate, templateVariables);
    const rawFilename = this.resolveTemplate(this.settings.noteFilenameTemplate, templateVariables);
    
    // Clean filename of invalid characters
    const cleanFilename = rawFilename.replace(/[\\\/:\*\?"<>\|]/g, '-').trim() || `Meeting-${dateStr}-${timeStr}`;
    const noteName = `${cleanFilename}.md`;

    // Ensure notes folder exists
    const targetNoteFolder = this.settings.noteFolder.trim();
    if (targetNoteFolder !== '') {
      const folderExists = this.app.vault.getFolderByPath(targetNoteFolder);
      if (!folderExists) {
        await this.app.vault.createFolder(targetNoteFolder);
      }
    }
    const folderPrefix = targetNoteFolder !== '' ? `${targetNoteFolder}/` : '';
    const notePath = `${folderPrefix}${noteName}`;

    // Create the note
    const noteFile = await this.app.vault.create(notePath, noteContent);
    new Notice(`Success! Created meeting note: ${notePath}`, 5000);

    // Insert link at cursor in current file if enabled and note creation succeeded
    if (this.settings.autoInsertLink) {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView && activeView.editor) {
        const link = `[[${noteFile.path}|Meeting - ${titleVal}]]`;
        activeView.editor.replaceSelection(link);
      }
    }

    // Open note
    await this.app.workspace.getLeaf().openFile(noteFile);
  }

  private resolveTemplate(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.split(`{{${key}}}`).join(value);
    }
    return result;
  }
}

class ApiKeyPromptModal extends Modal {
  private resolvePromise!: (value: boolean) => void;
  private whisperKeyInput = '';
  private geminiKeyInput = '';
  private providerKeyInput = '';

  constructor(
    app: App,
    private plugin: WhisperAudioPlugin,
    private needsWhisper: boolean,
    private needsGemini: boolean,
    private providerName: string
  ) {
    super(app);
  }

  promise(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText('AI Transcription & Summary - Missing Keys');

    const descriptionEl = contentEl.createEl('p', {
      text: 'To transcribe and process your audio, please enter the missing API keys below. They will be saved to your plugin settings.'
    });
    descriptionEl.style.marginBottom = '20px';

    if (this.needsWhisper) {
      new Setting(contentEl)
        .setName('Whisper API Key')
        .setDesc('Required for audio transcription via OpenAI Whisper.')
        .addText((text) =>
          text.setPlaceholder('Enter Whisper API key').onChange((val) => {
            this.whisperKeyInput = val.trim();
          })
        );
    }

    if (this.needsGemini) {
      new Setting(contentEl)
        .setName('Gemini API Key')
        .setDesc('Required for Gemini transcription and/or post-processing.')
        .addText((text) =>
          text.setPlaceholder('Enter Gemini API key').onChange((val) => {
            this.geminiKeyInput = val.trim();
          })
        );
    }

    if (this.providerName && this.providerName !== 'gemini') {
      const name = this.providerName.charAt(0).toUpperCase() + this.providerName.slice(1);
      new Setting(contentEl)
        .setName(`${name} API Key`)
        .setDesc(`Required for LLM post-processing using ${name}.`)
        .addText((text) =>
          text.setPlaceholder(`Enter ${name} API key`).onChange((val) => {
            this.providerKeyInput = val.trim();
          })
        );
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText('Save & Continue')
          .setCta()
          .onClick(async () => {
            if (this.needsWhisper && this.whisperKeyInput) {
              this.plugin.settings.whisperApiKey = this.whisperKeyInput;
            }
            if (this.needsGemini && this.geminiKeyInput) {
              this.plugin.settings.geminiApiKey = this.geminiKeyInput;
            }
            if (this.providerName && this.providerKeyInput) {
              if (this.plugin.settings.postProcessingProvider === 'anthropic') {
                this.plugin.settings.anthropicApiKey = this.providerKeyInput;
              } else if (this.plugin.settings.postProcessingProvider === 'openai') {
                this.plugin.settings.openaiApiKey = this.providerKeyInput;
              }
            }
            await this.plugin.saveSettings();
            this.resolvePromise(true);
            this.close();
          })
      )
      .addButton((btn) =>
        btn.setButtonText('Cancel').onClick(() => {
          this.resolvePromise(false);
          this.close();
        })
      );
  }

  onClose() {
    this.resolvePromise(false);
  }
}

class RecorderModal extends Modal {
  plugin: WhisperAudioPlugin;
  timerEl!: HTMLElement;
  statusEl!: HTMLElement;
  visualizerEl!: HTMLElement;
  controlsEl!: HTMLElement;

  constructor(app: App, plugin: WhisperAudioPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    this.titleEl.setText('AI Audio Recorder');

    const container = contentEl.createDiv({ cls: 'gemini-recorder-modal' });

    this.timerEl = container.createEl('div', { 
      cls: 'gemini-recorder-timer', 
      text: this.formatTime(this.plugin.recorder.duration) 
    });

    this.statusEl = container.createEl('div', { 
      cls: 'gemini-recorder-status',
      text: this.getStatusText()
    });

    this.visualizerEl = container.createDiv({ cls: 'gemini-recorder-visualizer' });
    for (let i = 0; i < 15; i++) {
      this.visualizerEl.createDiv({ cls: 'gemini-recorder-wave-bar' });
    }

    this.controlsEl = container.createDiv({ cls: 'gemini-recorder-controls' });

    this.updateControls();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  updateTimer(seconds: number) {
    if (this.timerEl) {
      this.timerEl.setText(this.formatTime(seconds));
    }
  }

  getStatusText(): string {
    const recorder = this.plugin.recorder;
    if (!recorder.isRecording) return 'Ready to record';
    if (recorder.isPaused) return 'Recording paused';
    return 'Recording audio...';
  }

  updateControls() {
    if (!this.controlsEl) return;
    this.controlsEl.empty();

    const recorder = this.plugin.recorder;

    if (this.visualizerEl) {
      if (recorder.isRecording && !recorder.isPaused) {
        this.visualizerEl.classList.add('recording');
      } else {
        this.visualizerEl.classList.remove('recording');
      }
    }

    if (this.statusEl) {
      this.statusEl.setText(this.getStatusText());
    }

    if (!recorder.isRecording) {
      const recordBtn = this.controlsEl.createEl('button', {
        cls: 'gemini-recorder-btn gemini-recorder-btn-record',
        text: '🎙️ Start Recording'
      });
      recordBtn.onclick = async () => {
        try {
          const maxChunkSize = this.plugin.settings.transcriptionProvider === 'gemini'
            ? 10 * 1024 * 1024
            : 22 * 1024 * 1024;
          await recorder.start(this.plugin.settings.selectedMic, maxChunkSize);
          this.updateControls();
        } catch (e) {
          new Notice('Error accessing microphone: ' + (e as Error).message);
        }
      };
    } else {
      if (recorder.isPaused) {
        const resumeBtn = this.controlsEl.createEl('button', {
          cls: 'gemini-recorder-btn gemini-recorder-btn-pause',
          text: '▶️ Resume'
        });
        resumeBtn.onclick = () => {
          recorder.resume();
          this.updateControls();
        };
      } else {
        const pauseBtn = this.controlsEl.createEl('button', {
          cls: 'gemini-recorder-btn gemini-recorder-btn-pause',
          text: '⏸️ Pause'
        });
        pauseBtn.onclick = () => {
          recorder.pause();
          this.updateControls();
        };
      }

      const stopBtn = this.controlsEl.createEl('button', {
        cls: 'gemini-recorder-btn gemini-recorder-btn-stop',
        text: '✅ Stop & Transcribe'
      });
      stopBtn.onclick = () => {
        this.close();
        this.plugin.handleStopAndProcess();
      };

      const cancelBtn = this.controlsEl.createEl('button', {
        cls: 'gemini-recorder-btn gemini-recorder-btn-cancel',
        text: '❌ Cancel'
      });
      cancelBtn.onclick = () => {
        if (confirm('Are you sure you want to cancel? This will delete the current recording.')) {
          recorder.cancel();
          this.updateControls();
          this.updateTimer(0);
          new Notice('Recording discarded.');
        }
      };
    }
  }

  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}
