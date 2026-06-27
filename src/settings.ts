import { App, PluginSettingTab, Setting } from 'obsidian';
import WhisperAudioPlugin from './main';

export interface WhisperAudioSettings {
  // API Keys
  whisperApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;

  // Transcription
  transcriptionProvider: 'openai' | 'gemini';
  geminiTranscriptionModel: string;
  apiUrl: string;
  model: string;
  language: string;
  prompt: string;
  temperature: number;
  responseFormat: string;

  // Recording
  selectedMic: string;
  saveAudioFile: boolean;
  audioFolder: string;

  // Output
  createNoteFile: boolean;
  noteFolder: string;
  noteFilenameTemplate: string;
  noteTemplate: string;
  autoInsertLink: boolean;
  promptOnSave: boolean;

  // Post-processing
  enablePostProcessing: boolean;
  postProcessingProvider: 'openai' | 'anthropic' | 'gemini';
  postProcessingModel: string;
  postProcessingPrompt: string;
  autoGenerateTitle: boolean;
  titlePrompt: string;
  keepOriginalTranscription: boolean;

  // Advanced
  debugMode: boolean;
}

export const DEFAULT_SETTINGS: WhisperAudioSettings = {
  whisperApiKey: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  geminiApiKey: '',

  transcriptionProvider: 'openai',
  geminiTranscriptionModel: 'gemini-2.5-flash',
  apiUrl: 'https://api.openai.com/v1',
  model: 'whisper-1',
  language: '',
  prompt: '',
  temperature: 0,
  responseFormat: 'json',

  selectedMic: 'default',
  saveAudioFile: true,
  audioFolder: 'Recordings',

  createNoteFile: true,
  noteFolder: 'Meetings',
  noteFilenameTemplate: '{{datetime}}',
  noteTemplate: '![[{{audioFile}}]]\n{{transcription}}',
  autoInsertLink: true,
  promptOnSave: false,

  enablePostProcessing: true,
  postProcessingProvider: 'anthropic',
  postProcessingModel: 'claude-3-5-haiku-20241022',
  postProcessingPrompt: 'You are a transcription editor. Clean up the following voice transcription: fix grammar, remove filler words (um, uh, like) and repetitions, and improve readability. Format the text in markdown. If there are action items or to-dos, format them as task lists with "[ ]". Preserve the original meaning and language. Return only the polished text, nothing else.',
  autoGenerateTitle: true,
  titlePrompt: 'Generate a short title (1-5 words) for the following text. Return only the title, nothing else.',
  keepOriginalTranscription: false,

  debugMode: false
};

export class WhisperAudioSettingTab extends PluginSettingTab {
  plugin: WhisperAudioPlugin;

  constructor(app: App, plugin: WhisperAudioPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'API Keys' });

    new Setting(containerEl)
      .setName('Whisper API Key')
      .setDesc('API key for Whisper transcription (OpenAI, Groq, or Azure)')
      .addText((text) =>
        text
          .setPlaceholder('Enter Whisper API key')
          .setValue(this.plugin.settings.whisperApiKey)
          .onChange(async (value) => {
            this.plugin.settings.whisperApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('OpenAI API Key')
      .setDesc('API key for GPT post-processing models')
      .addText((text) =>
        text
          .setPlaceholder('Enter OpenAI API key')
          .setValue(this.plugin.settings.openaiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openaiApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Anthropic API Key')
      .setDesc('API key for Claude post-processing models')
      .addText((text) =>
        text
          .setPlaceholder('Enter Anthropic API key')
          .setValue(this.plugin.settings.anthropicApiKey)
          .onChange(async (value) => {
            this.plugin.settings.anthropicApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Gemini API Key')
      .setDesc('API key for Gemini transcription and post-processing')
      .addText((text) =>
        text
          .setPlaceholder('Enter Gemini API key')
          .setValue(this.plugin.settings.geminiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.geminiApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl('h2', { text: 'Transcription' });

    new Setting(containerEl)
      .setName('Transcription Provider')
      .setDesc('Select whether to use OpenAI Whisper or Google Gemini for audio transcription')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('openai', 'OpenAI Whisper')
          .addOption('gemini', 'Google Gemini')
          .setValue(this.plugin.settings.transcriptionProvider)
          .onChange(async (value) => {
            this.plugin.settings.transcriptionProvider = value as any;
            await this.plugin.saveSettings();
            this.display(); // Redraw to toggle provider-specific settings
          })
      );

    if (this.plugin.settings.transcriptionProvider === 'openai') {
      new Setting(containerEl)
        .setName('API URL')
        .setDesc('Specify the endpoint that will be used to make requests to (e.g. OpenAI or Groq compatibility)')
        .addText((text) =>
          text
            .setPlaceholder('https://api.openai.com/v1')
            .setValue(this.plugin.settings.apiUrl)
            .onChange(async (value) => {
              this.plugin.settings.apiUrl = value.trim();
              await this.plugin.saveSettings();
            })
        );

      const modelOptions: Record<string, string> = {
        'whisper-1': 'whisper-1 (OpenAI)',
        'whisper-large-v3': 'whisper-large-v3 (Groq)',
        'whisper-large-v3-turbo': 'whisper-large-v3-turbo (Groq)',
        'custom': 'Custom Model ID'
      };
      
      const currentModel = this.plugin.settings.model;
      const isCustomModel = !['whisper-1', 'whisper-large-v3', 'whisper-large-v3-turbo'].includes(currentModel);
      
      new Setting(containerEl)
        .setName('Model')
        .setDesc('Select the transcription model (or choose Custom to enter your own)')
        .addDropdown((dropdown) => {
          dropdown
            .addOptions(modelOptions)
            .setValue(isCustomModel ? 'custom' : currentModel)
            .onChange(async (value) => {
              if (value === 'custom') {
                if (!isCustomModel) {
                  this.plugin.settings.model = '';
                }
              } else {
                this.plugin.settings.model = value;
              }
              await this.plugin.saveSettings();
              this.display(); // Redraw settings tab
            });
        });

      if (isCustomModel) {
        new Setting(containerEl)
          .setName('Custom Model ID')
          .setDesc('Enter custom Whisper-compatible model ID')
          .addText((text) =>
            text
              .setPlaceholder('e.g., whisper-1')
              .setValue(this.plugin.settings.model)
              .onChange(async (value) => {
                this.plugin.settings.model = value.trim();
                await this.plugin.saveSettings();
              })
          );
      }

      new Setting(containerEl)
        .setName('Language')
        .setDesc('Specify the language, or leave empty for auto-detection (e.g. en)')
        .addText((text) =>
          text
            .setPlaceholder('en (leave empty for auto)')
            .setValue(this.plugin.settings.language)
            .onChange(async (value) => {
              this.plugin.settings.language = value.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Prompt')
        .setDesc('Optional: Add words with their correct spellings to help with transcription.')
        .addText((text) =>
          text
            .setPlaceholder('Example: ZyntriQix, Digi')
            .setValue(this.plugin.settings.prompt)
            .onChange(async (value) => {
              this.plugin.settings.prompt = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Temperature')
        .setDesc('Sampling temperature (0 to 1). Higher values produce more random output.')
        .addText((text) =>
          text
            .setPlaceholder('0')
            .setValue(this.plugin.settings.temperature.toString())
            .onChange(async (value) => {
              const parsed = parseFloat(value);
              this.plugin.settings.temperature = isNaN(parsed) ? 0 : parsed;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Response format')
        .setDesc('Output format: json, text, srt, verbose_json, or vtt')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('json', 'json')
            .addOption('text', 'text')
            .addOption('verbose_json', 'verbose_json')
            .setValue(this.plugin.settings.responseFormat)
            .onChange(async (value) => {
              this.plugin.settings.responseFormat = value;
              await this.plugin.saveSettings();
            })
        );
    } else {
      // Gemini specific settings
      const geminiModels: Record<string, string> = {
        'gemini-2.5-flash': 'gemini-2.5-flash (Google Gemini)',
        'gemini-2.5-pro': 'gemini-2.5-pro (Google Gemini)',
        'gemini-3.5-flash': 'gemini-3.5-flash (Google Gemini)',
        'gemini-3.1-flash-lite': 'gemini-3.1-flash-lite (Google Gemini)',
        'custom': 'Custom Model ID'
      };
      
      const currentGeminiModel = this.plugin.settings.geminiTranscriptionModel || 'gemini-2.5-flash';
      const isCustomGemini = !['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'].includes(currentGeminiModel);
      
      new Setting(containerEl)
        .setName('Gemini Model')
        .setDesc('Select the Gemini model to transcribe your audio')
        .addDropdown((dropdown) => {
          dropdown
            .addOptions(geminiModels)
            .setValue(isCustomGemini ? 'custom' : currentGeminiModel)
            .onChange(async (value) => {
              if (value === 'custom') {
                if (!isCustomGemini) {
                  this.plugin.settings.geminiTranscriptionModel = '';
                }
              } else {
                this.plugin.settings.geminiTranscriptionModel = value;
              }
              await this.plugin.saveSettings();
              this.display(); // Redraw settings tab
            });
        });

      if (isCustomGemini) {
        new Setting(containerEl)
          .setName('Custom Gemini Model ID')
          .setDesc('Enter custom Gemini model ID')
          .addText((text) =>
            text
              .setPlaceholder('e.g., gemini-2.5-flash')
              .setValue(this.plugin.settings.geminiTranscriptionModel)
              .onChange(async (value) => {
                this.plugin.settings.geminiTranscriptionModel = value.trim();
                await this.plugin.saveSettings();
              })
          );
      }
    }

    containerEl.createEl('h2', { text: 'Recording' });

    // Asynchronously list microphones
    const micSetting = new Setting(containerEl)
      .setName('Microphone')
      .setDesc('Select the audio input device to use for recording');
    
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioMics = devices.filter(d => d.kind === 'audioinput');
      
      micSetting.addDropdown((dropdown) => {
        dropdown.addOption('default', 'Default Microphone');
        for (const mic of audioMics) {
          if (mic.deviceId) {
            dropdown.addOption(mic.deviceId, mic.label || `Microphone (${mic.deviceId.slice(0, 5)})`);
          }
        }
        dropdown.setValue(this.plugin.settings.selectedMic);
        dropdown.onChange(async (value) => {
          this.plugin.settings.selectedMic = value;
          await this.plugin.saveSettings();
        });
      });
    } catch (e) {
      micSetting.addDropdown((dropdown) => {
        dropdown.addOption('default', 'Default Microphone');
        dropdown.setValue('default');
      });
    }

    new Setting(containerEl)
      .setName('Save audio file')
      .setDesc('Save the audio recording to the vault')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.saveAudioFile)
          .onChange(async (value) => {
            this.plugin.settings.saveAudioFile = value;
            await this.plugin.saveSettings();
            this.display(); // Redraw settings to show/hide path config
          })
      );

    if (this.plugin.settings.saveAudioFile) {
      new Setting(containerEl)
        .setName('Audio save path')
        .setDesc('Folder in the vault where audio files are saved')
        .addText((text) =>
          text
            .setPlaceholder('Example: folder/audio')
            .setValue(this.plugin.settings.audioFolder)
            .onChange(async (value) => {
              this.plugin.settings.audioFolder = value.trim();
              await this.plugin.saveSettings();
            })
        );
    }

    containerEl.createEl('h2', { text: 'Output' });

    new Setting(containerEl)
      .setName('Create note file')
      .setDesc('Create a new note file for each transcription (if disabled, inserts directly at current cursor position)')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.createNoteFile)
          .onChange(async (value) => {
            this.plugin.settings.createNoteFile = value;
            await this.plugin.saveSettings();
            this.display(); // Redraw settings to show/hide note settings
          })
      );

    if (this.plugin.settings.createNoteFile) {
      new Setting(containerEl)
        .setName('Note save path')
        .setDesc('Folder in the vault where note files are saved')
        .addText((text) =>
          text
            .setPlaceholder('Example: folder/note')
            .setValue(this.plugin.settings.noteFolder)
            .onChange(async (value) => {
              this.plugin.settings.noteFolder = value.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Note filename template')
        .setDesc('Template for note filenames. Variables: {{date}}, {{time}}, {{datetime}}, {{title}}')
        .addText((text) =>
          text
            .setPlaceholder('{{datetime}}')
            .setValue(this.plugin.settings.noteFilenameTemplate)
            .onChange(async (value) => {
              this.plugin.settings.noteFilenameTemplate = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Note template')
        .setDesc('Template for note content. Variables: {{transcription}}, {{audioFile}}, {{date}}, {{time}}, {{datetime}}, {{title}}. Use ![[{{audioFile}}]] to embed or [[{{audioFile}}]] to link.')
        .addTextArea((text) =>
          text
            .setPlaceholder('![[{{audioFile}}]]\n{{transcription}}')
            .setValue(this.plugin.settings.noteTemplate)
            .onChange(async (value) => {
              this.plugin.settings.noteTemplate = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Auto-Insert Link')
        .setDesc('Automatically insert a link to the generated meeting note in your active file at the cursor position.')
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.autoInsertLink)
            .onChange(async (value) => {
              this.plugin.settings.autoInsertLink = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Prompt on save')
        .setDesc('Display a popup to customize the folder and filename before saving the note file.')
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.promptOnSave)
            .onChange(async (value) => {
              this.plugin.settings.promptOnSave = value;
              await this.plugin.saveSettings();
            })
        );
    }

    containerEl.createEl('h2', { text: 'Post-processing' });

    new Setting(containerEl)
      .setName('Enable post-processing')
      .setDesc('Clean up transcriptions with an LLM — fix grammar, remove filler words, improve readability')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enablePostProcessing)
          .onChange(async (value) => {
            this.plugin.settings.enablePostProcessing = value;
            await this.plugin.saveSettings();
            this.display(); // Redraw settings to show/hide post-processing settings
          })
      );

    if (this.plugin.settings.enablePostProcessing) {
      new Setting(containerEl)
        .setName('Provider')
        .setDesc('Select the LLM provider to clean up your note (Anthropic and OpenAI use API keys set above)')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('anthropic', 'Anthropic')
            .addOption('openai', 'OpenAI')
            .addOption('gemini', 'Gemini')
            .setValue(this.plugin.settings.postProcessingProvider)
            .onChange(async (value) => {
              this.plugin.settings.postProcessingProvider = value as any;
              
              // Set reasonable default model when provider changes
              if (value === 'anthropic') {
                this.plugin.settings.postProcessingModel = 'claude-3-5-haiku-20241022';
              } else if (value === 'openai') {
                this.plugin.settings.postProcessingModel = 'gpt-4o-mini';
              } else if (value === 'gemini') {
                this.plugin.settings.postProcessingModel = 'gemini-2.5-flash';
              }
              
              await this.plugin.saveSettings();
              this.display();
            })
        );

      let recommendedModels: Record<string, string> = {};
      let defaultModel = '';
      
      const provider = this.plugin.settings.postProcessingProvider;
      if (provider === 'anthropic') {
        recommendedModels = {
          'claude-3-5-haiku-20241022': 'claude-3-5-haiku (Anthropic)',
          'claude-3-5-sonnet-20241022': 'claude-3-5-sonnet (Anthropic)',
          'custom': 'Custom Model ID'
        };
        defaultModel = 'claude-3-5-haiku-20241022';
      } else if (provider === 'openai') {
        recommendedModels = {
          'gpt-4o-mini': 'gpt-4o-mini (OpenAI)',
          'gpt-4o': 'gpt-4o (OpenAI)',
          'custom': 'Custom Model ID'
        };
        defaultModel = 'gpt-4o-mini';
      } else if (provider === 'gemini') {
        recommendedModels = {
          'gemini-2.5-flash': 'gemini-2.5-flash (Google Gemini)',
          'gemini-2.5-pro': 'gemini-2.5-pro (Google Gemini)',
          'gemini-3.5-flash': 'gemini-3.5-flash (Google Gemini)',
          'gemini-3.1-flash-lite': 'gemini-3.1-flash-lite (Google Gemini)',
          'custom': 'Custom Model ID'
        };
        defaultModel = 'gemini-2.5-flash';
      }
      
      const currentPPModel = this.plugin.settings.postProcessingModel || defaultModel;
      const isCustomPP = !Object.keys(recommendedModels).filter(k => k !== 'custom').includes(currentPPModel);
      
      new Setting(containerEl)
        .setName('Post-processing model')
        .setDesc('Select the model for post-processing')
        .addDropdown((dropdown) => {
          dropdown
            .addOptions(recommendedModels)
            .setValue(isCustomPP ? 'custom' : currentPPModel)
            .onChange(async (value) => {
              if (value === 'custom') {
                if (!isCustomPP) {
                  this.plugin.settings.postProcessingModel = '';
                }
              } else {
                this.plugin.settings.postProcessingModel = value;
              }
              await this.plugin.saveSettings();
              this.display(); // Redraw settings tab
            });
        });

      if (isCustomPP) {
        new Setting(containerEl)
          .setName('Custom Post-processing Model ID')
          .setDesc('Enter custom model ID')
          .addText((text) =>
            text
              .setPlaceholder(`e.g., ${defaultModel}`)
              .setValue(this.plugin.settings.postProcessingModel)
              .onChange(async (value) => {
                this.plugin.settings.postProcessingModel = value.trim();
                await this.plugin.saveSettings();
              })
          );
      }

      new Setting(containerEl)
        .setName('Post-processing prompt')
        .setDesc('Instructions for the LLM on how to clean up the transcription')
        .addTextArea((text) =>
          text
            .setPlaceholder('Enter prompt...')
            .setValue(this.plugin.settings.postProcessingPrompt)
            .onChange(async (value) => {
              this.plugin.settings.postProcessingPrompt = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Auto-generate title')
        .setDesc('Use the LLM to generate a descriptive filename/title for notes')
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.autoGenerateTitle)
            .onChange(async (value) => {
              this.plugin.settings.autoGenerateTitle = value;
              await this.plugin.saveSettings();
              this.display();
            })
        );

      if (this.plugin.settings.autoGenerateTitle) {
        new Setting(containerEl)
          .setName('Title generation prompt')
          .setDesc('Instructions for the LLM on how to generate the title')
          .addTextArea((text) =>
            text
              .setPlaceholder('Generate a short title...')
              .setValue(this.plugin.settings.titlePrompt)
              .onChange(async (value) => {
                this.plugin.settings.titlePrompt = value;
                await this.plugin.saveSettings();
              })
          );
      }

      new Setting(containerEl)
        .setName('Keep original transcription')
        .setDesc('Append the raw Whisper transcription below the post-processed text')
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.keepOriginalTranscription)
            .onChange(async (value) => {
              this.plugin.settings.keepOriginalTranscription = value;
              await this.plugin.saveSettings();
            })
        );
    }

    containerEl.createEl('h2', { text: 'Advanced' });

    new Setting(containerEl)
      .setName('Debug mode')
      .setDesc('Increase the plugin\'s verbosity for troubleshooting')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugMode)
          .onChange(async (value) => {
            this.plugin.settings.debugMode = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
