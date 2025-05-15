import os
import requests
from PIL import Image
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi import BackgroundTasks
from transformers import BlipProcessor, BlipForConditionalGeneration
from deep_translator import GoogleTranslator
from gtts import gTTS
import speech_recognition as sr
import uvicorn
from typing import Optional
import tempfile
import re
from pydub import AudioSegment
import uuid
import io
import wave

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize models and processors
processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base")
recognizer = sr.Recognizer()

# Configuration
GROQ_API_KEY = "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"
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama3-70b-8192"

language_map = {
    "English": "en", "Hindi": "hi", "Telugu": "te", "Kannada": "kn",
    "Tamil": "ta", "Marathi": "mr", "Malayalam": "ml"
}

def save_temp_file(content: bytes, extension: str) -> str:
    temp_dir = os.path.join(os.getcwd(), "temp_audio")
    os.makedirs(temp_dir, exist_ok=True)
    filename = f"{uuid.uuid4()}{extension}"
    filepath = os.path.join(temp_dir, filename)
    with open(filepath, "wb") as f:
        f.write(content)
    return filepath

def convert_audio(audio_bytes: bytes) -> bytes:
    try:
        # First try to read as webm
        try:
            audio = AudioSegment.from_file(io.BytesIO(audio_bytes), format="webm")
        except:
            # If webm fails, try wav
            audio = AudioSegment.from_file(io.BytesIO(audio_bytes), format="wav")
        
        # Convert to WAV format with correct parameters
        wav_io = io.BytesIO()
        audio.set_frame_rate(16000).set_channels(1).export(wav_io, format="wav")
        return wav_io.getvalue()
    except Exception as e:
        print(f"Audio conversion error: {str(e)}")
        return audio_bytes

def transcribe_audio(audio_bytes: bytes) -> str:
    try:
        audio_bytes = convert_audio(audio_bytes)
        
        with io.BytesIO(audio_bytes) as audio_io:
            with sr.AudioFile(audio_io) as source:
                audio = recognizer.record(source)
                return recognizer.recognize_google(audio, language="en-IN")
    except sr.UnknownValueError:
        return "[Could not understand audio]"
    except Exception as e:
        print(f"Transcription error: {str(e)}")
        return "[Audio processing failed]"

def caption_image(image_bytes: bytes) -> str:
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
        inputs = processor(image, return_tensors="pt")
        out = model.generate(**inputs)
        return processor.decode(out[0], skip_special_tokens=True)
    except Exception as e:
        print(f"Image processing error: {str(e)}")
        return "[Image processing failed]"

def ask_groq(prompt: str, personality: str) -> str:
    try:
        headers = {
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json"
        }

        instruction = (
            "You are a medical expert. Carefully analyze both the image description "
            "and any audio/text input to provide accurate advice. For image-related "
            "queries, focus on visual details mentioned."
        )

        messages = [
            {"role": "system", "content": instruction},
            {"role": "user", "content": prompt}
        ]

        response = requests.post(
            GROQ_API_URL,
            headers=headers,
            json={
                "model": GROQ_MODEL,
                "messages": messages,
                "temperature": 0.7
            },
            timeout=30
        )
        response.raise_for_status()

        content = response.json()['choices'][0]['message']['content']
        return re.sub(r'\*\*(.*?)\*\*', r'**\1**', content)  # Keep markdown formatting
    except Exception as e:
        print(f"Groq API error: {str(e)}")
        return "I encountered an error processing your request. Please try again."

def speak_response(text: str, language_code: str) -> Optional[str]:
    try:
        clean_text = re.sub('<[^<]+?>', '', text)
        if not clean_text.strip():
            return None

        # Create temp file path
        temp_dir = os.path.join(os.getcwd(), "temp_audio")
        os.makedirs(temp_dir, exist_ok=True)
        filename = f"{uuid.uuid4()}.mp3"
        audio_path = os.path.join(temp_dir, filename)

        tts = gTTS(text=clean_text, lang=language_code, slow=False)
        tts.save(audio_path)
        return f"/audio/{filename}"
    except Exception as e:
        print(f"Speech synthesis error: {str(e)}")
        return None

def translate_text(text: str, language: str) -> str:
    try:
        if language not in language_map or language == "English":
            return text
        return GoogleTranslator(source='auto', target=language_map[language]).translate(text)
    except Exception as e:
        print(f"Translation error: {str(e)}")
        return text

@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/docs")

@app.post("/chat/")
async def chat(
    text: Optional[str] = Form(None),
    personality: str = Form("Modern"),
    language: str = Form("English"),
    image: Optional[UploadFile] = File(None),
    audio: Optional[UploadFile] = File(None),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    try:
        prompt_parts = []

        image_description = ""
        if image:
            image_bytes = await image.read()
            image_description = caption_image(image_bytes)
            prompt_parts.append(f"IMAGE ANALYSIS: {image_description}")

        transcribed_text = ""
        if audio:
            audio_bytes = await audio.read()
            transcribed_text = transcribe_audio(audio_bytes)
            prompt_parts.append(f"AUDIO TRANSCRIPT: {transcribed_text}")

        if text:
            prompt_parts.append(f"USER QUESTION: {text}")

        if not prompt_parts:
            raise HTTPException(status_code=400, detail="No input provided")

        prompt = "\n".join(prompt_parts)
        bot_response = ask_groq(prompt, personality)
        translated_response = translate_text(bot_response, language)

        audio_url = speak_response(translated_response, language_map.get(language, "en"))

        return {
            "text": translated_response,
            "audio_url": audio_url,
            "language": language
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/audio/{filename}")
async def get_audio(filename: str, background_tasks: BackgroundTasks):
    audio_path = os.path.join(os.getcwd(), "temp_audio", filename)
    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")

    background_tasks.add_task(lambda: os.remove(audio_path) if os.path.exists(audio_path) else None)
    return FileResponse(audio_path, media_type="audio/mpeg")

if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)