import { App, TFile } from 'obsidian';

export interface RecorderResult {
  files: TFile[];
  blobs: Blob[];
  mimeType: string;
  duration: number;
}

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private audioChunks: Blob[] = [];
  private timerInterval: NodeJS.Timeout | null = null;
  private currentChunkSizeBytes = 0;
  private maxChunkSizeBytes = 22 * 1024 * 1024; // 22MB for safety margin
  private recordedBlobs: Blob[] = [];
  
  public isRecording = false;
  public isPaused = false;
  public duration = 0;
  
  public onTick: (duration: number) => void = () => {};
  public onStateChange: (state: { isRecording: boolean; isPaused: boolean }) => void = () => {};

  constructor(private app: App) {}

  private getSupportedMimeType(): string {
    // Standard types supported across browsers, prioritizing WebM on desktop and MP4/AAC on iOS/macOS Safari
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/aac',
      'audio/mpeg'
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return '';
  }

  private getExtensionFromMimeType(mimeType: string): string {
    if (mimeType.includes('webm')) return 'webm';
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('mp4') || mimeType.includes('aac')) return 'm4a';
    if (mimeType.includes('mpeg')) return 'mp3';
    return 'webm'; // Fallback
  }

  async start(deviceId = 'default', maxChunkSizeBytes = 22 * 1024 * 1024): Promise<void> {
    this.maxChunkSizeBytes = maxChunkSizeBytes;
    const constraints: MediaStreamConstraints = {
      audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } }
    };
    
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    const mimeType = this.getSupportedMimeType();
    
    const options = mimeType ? { mimeType } : undefined;
    this.mediaRecorder = new MediaRecorder(this.stream, options);
    
    this.audioChunks = [];
    this.recordedBlobs = [];
    this.currentChunkSizeBytes = 0;
    this.duration = 0;
    
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.audioChunks.push(event.data);
        this.currentChunkSizeBytes += event.data.size;
        
        if (this.currentChunkSizeBytes >= this.maxChunkSizeBytes) {
          this.rolloverChunk();
        }
      }
    };
    
    // Start recording with timeslice (e.g., 250ms) to ensure ondataavailable fires continuously
    this.mediaRecorder.start(250);
    
    this.isRecording = true;
    this.isPaused = false;
    
    this.timerInterval = setInterval(() => {
      this.duration += 1;
      this.onTick(this.duration);
    }, 1000);
    
    this.onStateChange({ isRecording: this.isRecording, isPaused: this.isPaused });
  }

  private async rolloverChunk(): Promise<void> {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording' || !this.stream) {
      return;
    }
    
    const oldRecorder = this.mediaRecorder;
    
    // Divert the dataavailable listener of the old recorder to a local chunks array
    // to capture the final frames upon stop() without polluting the new recorder's chunks.
    const oldChunks = [...this.audioChunks];
    oldRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        oldChunks.push(event.data);
      }
    };
    
    // Reset chunk tracking for the NEW recorder
    this.audioChunks = [];
    this.currentChunkSizeBytes = 0;
    
    // Start a new MediaRecorder instance on the same stream seamlessly
    const mimeType = this.getSupportedMimeType();
    const options = mimeType ? { mimeType } : undefined;
    this.mediaRecorder = new MediaRecorder(this.stream, options);
    
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.audioChunks.push(event.data);
        this.currentChunkSizeBytes += event.data.size;
        
        if (this.currentChunkSizeBytes >= this.maxChunkSizeBytes) {
          this.rolloverChunk();
        }
      }
    };
    
    this.mediaRecorder.start(250);
    
    // Stop the old recorder and process its chunks
    oldRecorder.onstop = () => {
      const finalMime = oldRecorder.mimeType || this.getSupportedMimeType() || 'audio/webm';
      const blob = new Blob(oldChunks, { type: finalMime });
      this.recordedBlobs.push(blob);
    };
    
    oldRecorder.stop();
  }

  pause(): void {
    if (this.mediaRecorder && this.isRecording && !this.isPaused) {
      this.mediaRecorder.pause();
      this.isPaused = true;
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
      this.onStateChange({ isRecording: this.isRecording, isPaused: this.isPaused });
    }
  }

  resume(): void {
    if (this.mediaRecorder && this.isRecording && this.isPaused) {
      this.mediaRecorder.resume();
      this.isPaused = false;
      this.timerInterval = setInterval(() => {
        this.duration += 1;
        this.onTick(this.duration);
      }, 1000);
      this.onStateChange({ isRecording: this.isRecording, isPaused: this.isPaused });
    }
  }

  async stop(targetFolder = '', saveToVault = true): Promise<RecorderResult> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('Recorder not started.'));
        return;
      }
      
      this.mediaRecorder.onstop = async () => {
        try {
          const finalMime = this.mediaRecorder!.mimeType || this.getSupportedMimeType() || 'audio/webm';
          const ext = this.getExtensionFromMimeType(finalMime);
          
          // Add the final chunk
          const finalBlob = new Blob(this.audioChunks, { type: finalMime });
          this.recordedBlobs.push(finalBlob);
          
          const files: TFile[] = [];
          
          if (saveToVault) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            
            // Resolve output directory
            const cleanFolder = targetFolder.trim();
            if (cleanFolder !== '') {
              const folderExists = this.app.vault.getFolderByPath(cleanFolder);
              if (!folderExists) {
                await this.app.vault.createFolder(cleanFolder);
              }
            }
            const prefix = cleanFolder !== '' ? `${cleanFolder}/` : '';
            
            for (let i = 0; i < this.recordedBlobs.length; i++) {
              const suffix = this.recordedBlobs.length > 1 ? `-part${i + 1}` : '';
              const fileName = `Recording-${timestamp}${suffix}.${ext}`;
              const filePath = `${prefix}${fileName}`;
              
              const arrayBuffer = await this.recordedBlobs[i].arrayBuffer();
              const file = await this.app.vault.createBinary(filePath, arrayBuffer);
              files.push(file);
            }
          }
          
          const blobs = [...this.recordedBlobs];
          this.cleanup();
          resolve({
            files,
            blobs,
            mimeType: finalMime,
            duration: this.duration
          });
        } catch (e) {
          this.cleanup();
          reject(e);
        }
      };
      
      this.mediaRecorder.stop();
    });
  }

  cancel(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.onstop = () => {};
      this.mediaRecorder.stop();
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.recordedBlobs = [];
    this.isRecording = false;
    this.isPaused = false;
    this.duration = 0;
    this.onStateChange({ isRecording: this.isRecording, isPaused: this.isPaused });
  }
}
