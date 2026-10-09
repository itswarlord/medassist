from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import main  # Imports your logic from main.py

app = FastAPI()

# Disables CORS security so localhost:3000 (React) can talk to localhost:8000 (Python)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    user_query: str
    session_id: str

@app.post("/api/v1/medibot/query")
def chat_endpoint(request: ChatRequest):
    # Passes the request directly to the core LangChain engine
    response_payload = main.process_medibot_query(request.user_query, request.session_id)
    
    print("\n📦 --- API ENDPOINT PROCESSED PAYLOAD ---")
    import json
    print(json.dumps(response_payload, indent=2))
    
    return response_payload

if __name__ == "__main__":
    import uvicorn
    print("🚀 MediBot API Gateway running on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)