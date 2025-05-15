import React, { useState, useRef, useEffect } from 'react';
import { Mic, Send, Image as ImageIcon, Loader2, AlertCircle } from 'lucide-react';

export default function MedicalChat() {
  // State
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [personality, setPersonality] = useState('Modern');
  const [language, setLanguage] = useState('English');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [backendError, setBackendError] = useState(false);

  // Refs
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const messagesEndRef = useRef(null);

  // Supported languages
  const languages = ['English', 'Hindi', 'Telugu', 'Kannada', 'Tamil', 'Marathi', 'Malayalam'];

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Test backend connection
  useEffect(() => {
    const testConnection = async () => {
      try {
        const response = await fetch('http://localhost:8000/health');
        if (!response.ok) throw new Error();
        setBackendError(false);
      } catch (error) {
        setBackendError(true);
        setMessages(prev => [...prev, {
          role: 'bot',
          text: 'Backend connection failed. Please ensure the server is running on port 8000.',
          isError: true
        }]);
      }
    };
    testConnection();
  }, []);

  // API call
  const callAPI = async (formData) => {
    setIsProcessing(true);
    try {
      const response = await fetch('http://localhost:8000/chat/', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('API call failed:', error);
      setBackendError(true);
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle image upload
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setMessages(prev => [...prev, {
        role: 'bot',
        text: 'Please upload an image file (JPEG, PNG, etc.)',
        isError: true
      }]);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target.result);
    reader.readAsDataURL(file);
  };

  // Voice recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await handleSend(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.start(100);
      setIsRecording(true);
      setMessages(prev => [...prev, { 
        role: 'user', 
        text: '[Voice message...]',
        isRecording: true
      }]);
    } catch (error) {
      console.error('Recording error:', error);
      setMessages(prev => [...prev, { 
        role: 'bot', 
        text: 'Error: Microphone access denied or recording failed',
        isError: true
      }]);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // Handle message submission
  const handleSend = async (audioBlob = null) => {
    if ((!input.trim() && !imagePreview && !audioBlob) || isProcessing) return;

    const formData = new FormData();

    // Add image if available
    if (imagePreview && fileInputRef.current?.files?.[0]) {
      formData.append('image', fileInputRef.current.files[0]);
    }

    // Add audio if available
    if (audioBlob) {
      formData.append('audio', audioBlob, 'recording.webm');
    } else if (audioChunksRef.current.length > 0) {
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      formData.append('audio', blob, 'recording.webm');
    }

    // Add text
    if (input.trim()) {
      formData.append('text', input);
    } else if (imagePreview && !audioBlob) {
      formData.append('text', "Please analyze this image");
    }

    formData.append('personality', personality);
    formData.append('language', language);

    // Add user message
    const newMessage = {
      role: 'user',
      text: input || (audioBlob ? '[Voice message]' : 'Analyze image'),
    };
    if (imagePreview) newMessage.imageUrl = imagePreview;
    setMessages(prev => [...prev, newMessage]);

    // Clear inputs
    setInput('');
    setImagePreview(null);
    audioChunksRef.current = [];
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Get response
    const response = await callAPI(formData);
    if (response) {
      setMessages(prev => [...prev, { 
        role: 'bot', 
        text: response.text,
        audioUrl: response.audio_url ? `http://localhost:8000${response.audio_url}` : null,
        language: response.language
      }]);
      setBackendError(false);
    }
  };

  // Format message text
  const formatMessageText = (text) => {
    if (!text) return null;
    return text.split('\n').map((paragraph, i) => (
      <p key={i} className="mb-2" dangerouslySetInnerHTML={{
        __html: paragraph.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      }} />
    ));
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r p-4 space-y-4 hidden md:block">
        <h2 className="text-xl font-semibold text-gray-800">HOPE</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Personality</label>
            <select
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              className="w-full p-2 border rounded-lg bg-gray-50"
            >
              <option value="Modern">Modern Medicine</option>
              <option value="Ayurvedic">Ayurvedic Medicine</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full p-2 border rounded-lg bg-gray-50"
            >
              {languages.map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`p-4 rounded-xl max-w-[90%] md:max-w-[80%] ${
                msg.role === 'user'
                  ? 'bg-blue-100 ml-auto rounded-br-none'
                  : msg.isError
                    ? 'bg-red-100 mr-auto rounded-bl-none'
                    : 'bg-white mr-auto rounded-bl-none border'
              }`}
            >
              {msg.language && msg.language !== 'English' && msg.role === 'bot' && (
                <div className="text-xs text-gray-500 mb-1">
                  Response in {msg.language}
                </div>
              )}
              
              {msg.imageUrl && (
                <img 
                  src={msg.imageUrl} 
                  alt="Uploaded" 
                  className="max-w-full md:max-w-xs rounded-lg mb-2"
                />
              )}
              
              <div className="text-gray-800">
                {msg.isRecording ? (
                  <div className="flex items-center gap-2 text-gray-500">
                    <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse"></div>
                    Recording...
                  </div>
                ) : (
                  formatMessageText(msg.text)
                )}
              </div>
              
              {msg.audioUrl && (
                <div className="mt-2">
                  <audio
                    controls
                    autoPlay
                    className="w-full max-w-xs"
                    src={msg.audioUrl}
                  />
                </div>
              )}
            </div>
          ))}
          
          {imagePreview && !messages.some(m => m.imageUrl === imagePreview) && (
            <div className="p-4 bg-blue-100 ml-auto rounded-xl rounded-br-none max-w-[90%] md:max-w-[80%]">
              <img 
                src={imagePreview} 
                alt="Preview" 
                className="max-w-full md:max-w-xs rounded-lg mb-2"
              />
              <p className="text-gray-500 text-sm">Image loaded - add your question</p>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t bg-white p-4">
          {backendError && (
            <div className="flex items-center gap-2 text-red-500 text-sm mb-2 p-2 bg-red-50 rounded-lg">
              <AlertCircle size={16} />
              Backend connection failed
            </div>
          )}
          
          {isProcessing && (
            <div className="flex items-center gap-2 text-blue-500 text-sm mb-2 p-2 bg-blue-50 rounded-lg">
              <Loader2 size={16} className="animate-spin" />
              Processing...
            </div>
          )}

          <div className="flex items-center gap-2 bg-gray-50 rounded-full px-4">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/*"
              className="hidden"
              disabled={isProcessing}
            />
            <button
              onClick={() => fileInputRef.current.click()}
              className="p-2 text-gray-500 hover:text-gray-700"
              disabled={isProcessing}
            >
              <ImageIcon size={20} />
            </button>

            <input
              type="text"
              placeholder={imagePreview ? "Ask about this image..." : "Type your message..."}
              className="flex-1 py-3 bg-transparent outline-none"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              disabled={isProcessing || isRecording}
            />

            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`p-2 rounded-full ${
                isRecording ? 'bg-red-500 text-white' : 'text-gray-500 hover:text-gray-700'
              }`}
              disabled={isProcessing}
            >
              <Mic size={20} />
            </button>
            
            <button
              onClick={() => handleSend()}
              disabled={isProcessing || (!input && !imagePreview && audioChunksRef.current.length === 0)}
              className="p-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 disabled:opacity-50"
            >
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}