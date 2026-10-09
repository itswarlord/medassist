import json
import os
import warnings
import mysql.connector
from dotenv import load_dotenv
from caspian import Caspian

from pydantic import BaseModel, Field
from typing import List, Optional
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate




load_dotenv()

# Suppress warnings


warnings.filterwarnings("ignore", category=UserWarning, module="langchain_google_genai")

# Initialize Caspian client


cx = Caspian(api_key=os.getenv("CASPIAN_API_KEY"))
cx.channels.add("telegram", bot_token=os.getenv("TELEGRAM_BOT_TOKEN"))



llm = ChatGoogleGenerativeAI(
    model="gemini-3.5-flash-lite", 
    api_key=os.getenv("GEMINI_API_KEY")
)

# --- Database Helpers ---
def get_db_connection():
    return mysql.connector.connect(
        host=os.getenv("MYSQL_HOST", "localhost"),
        user=os.getenv("MYSQL_USER", "medibot_user"),
        password=os.getenv("MYSQL_PASSWORD", "mypassword123"),
        database=os.getenv("MYSQL_DATABASE", "medibot_db"),
    )

def loadhistory(session_id: str) -> list:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT history_json FROM sessions WHERE session_id = %s", (session_id,))
        row = cursor.fetchone()
        if row and row[0]:
            return json.loads(row[0]) if isinstance(row[0], str) else row[0]
        return []
    finally:
        cursor.close()
        conn.close()

def addhistory(session_id: str, message_pair: dict):
    history = loadhistory(session_id)
    history.append(message_pair)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        query = """
            INSERT INTO sessions (session_id, history_json)
            VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE history_json = VALUES(history_json)
        """
        cursor.execute(query, (session_id, json.dumps(history)))
        conn.commit()
    finally:
        cursor.close()
        conn.close()

def del_user_history(session_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        query = "DELETE FROM sessions WHERE session_id = %s"
        cursor.execute(query, (session_id,))
        conn.commit()
    finally:
        cursor.close()
        conn.close()


# --- Pydantic API Schema ---
class PartnerPrice(BaseModel):
    platform: str
    price_inr: float
    delivery_eta: str
    in_stock: bool

class SubstituteData(BaseModel):
    brand_name: str
    manufacturer: str
    active_composition: str
    composition_identically_verified: bool
    mrp_inr: float
    savings_percentage: float
    user_advisory: str
    partner_price_comparison: List[PartnerPrice]

class DetectedMedicationData(BaseModel):
    brand_name: str
    active_composition: str
    therapeutic_class: str
    schedule: str
    mrp_inr: float

class PromptData(BaseModel):
    intent: str
    is_safe: bool
    is_scheduleH: bool
    detected_medication: Optional[DetectedMedicationData] = None
    substitutes: Optional[List[SubstituteData]] = []


extractor_llm = llm.with_structured_output(PromptData)


prompt_template = ChatPromptTemplate.from_messages([
    ("system", 
     "You are the intelligence engine for an Indian pharmacist API. "
     "Analyze the user's query IN THE CONTEXT of their chat history. "
     "If they ask for a medicine alternative, mock the exact data required: "
     "therapeutic class, MRP, manufacturers, and realistic partner pricing (1mg, PharmEasy, Apollo). "
     "Ensure the substitutes share the EXACT identical active composition. "
     "CRITICAL SAFETY RULE: Asking about a specific drug is SAFE (is_safe=True). "
     "Asking for a diagnosis based on a symptom is UNSAFE (is_safe=False)."
    ),
    ("system", "Chat History Context:\n{history}"),
    ("human", "{text}")
])

extraction_chain = prompt_template | extractor_llm





def process_medibot_query(user_prompt: str, session_id: str) -> dict:
    command = user_prompt.strip().lower()
    if command == "/start":
        return {"status": "success", "reply": "Welcome to MediBot! 💊 Type the name of a medicine to find cheaper alternatives."}
    if command == "/help":
        return {"status": "success", "reply": "Just send me a medicine name like 'Augmentin 625' and I will find a cheaper substitute with the same salts."}
    if command == "/new":
        del_user_history(session_id)
        return {"status": "success", "reply": "🧹 Session cleared. We are starting fresh!"}

    user_history = loadhistory(session_id)
    first_time_user = len(user_history) == 0

    try:
        history_text_lines = []
        for turn in user_history:
            history_text_lines.append(f"User: {turn.get('user_input', '')}")
            history_text_lines.append(f"API Response: {json.dumps(turn.get('bot_response', {}))}")
        history_text = "\n".join(history_text_lines)
        
        extracted_data = extraction_chain.invoke({
            "text": user_prompt, 
            "history": history_text
        })
    except Exception as e:
        return {"status": "error", "reply": f"Extraction Failed: {str(e)}"}

    is_diagnosis_detected = not extracted_data.is_safe
    is_restricted_schedule_h = extracted_data.is_scheduleH
    intercept_triggered = is_diagnosis_detected or is_restricted_schedule_h

    mandated_prompt = None
    if is_diagnosis_detected:
        mandated_prompt = "⚠️ Safety Warning: I cannot diagnose symptoms or prescribe treatments. Please consult a doctor immediately."
    elif is_restricted_schedule_h:
        mandated_prompt = "This medication requires a valid prescription. Please consult your doctor."

    final_api_response = {
        "user_query": user_prompt,
        "session_id": session_id,
        "disclaimer_acknowledged": not first_time_user,
        "safety_guard": {
            "is_restricted_schedule_h": is_restricted_schedule_h,
            "intercept_triggered": intercept_triggered,
            "mandated_prompt": mandated_prompt,
            "is_diagnosis_detected": is_diagnosis_detected
        },
        "detected_medication": extracted_data.detected_medication.model_dump() if extracted_data.detected_medication else None,
        "substitutes": [sub.model_dump() for sub in extracted_data.substitutes] if extracted_data.substitutes else [],
        "disclaimer": "MediBot is an informational tool. It does not diagnose medical conditions or prescribe medications. Users must always consult a qualified medical professional before taking any medication."
    }

    addhistory(session_id, {
        "user_input": user_prompt,
        "bot_response": final_api_response
    })

    return final_api_response



def format_telegram_reply(payload: dict) -> str:
    # Handle simple text replies from commands
    if "status" in payload:
        return payload["reply"]
        
    guard = payload.get("safety_guard", {})
    med = payload.get("detected_medication")
    subs = payload.get("substitutes", [])
    
    reply_text = ""
    
    # 1. Safety Alerts
    if guard.get("intercept_triggered"):
        reply_text += f"🛑 **{guard.get('mandated_prompt')}**\n\n"
        
    # 2. Target Drug Data
    if med:
        reply_text += f"💊 **Target Drug:** {med.get('brand_name')} (₹{med.get('mrp_inr')})\n"
        reply_text += f"🧪 **Composition:** {med.get('active_composition')}\n"
        reply_text += f"📋 **Class:** {med.get('therapeutic_class')} | {med.get('schedule')}\n\n"


        
    # 3. Substitutes Data
    if subs:
        reply_text += "✅ **Cheaper Alternatives:**\n"
        for sub in subs:
            reply_text += f"- **{sub.get('brand_name')}** by {sub.get('manufacturer')}\n"
            reply_text += f"  💰 Price: ₹{sub.get('mrp_inr')} (Save {sub.get('savings_percentage')}%)\n"
    elif not med:
        reply_text = "I'm sorry, I couldn't identify a specific medicine. Could you rephrase?"
        
    reply_text += f"\n_{payload.get('disclaimer')}_"
    return reply_text





@cx.on_message({"overlap": "queue", "ack": "Analyzing..."})
def handle_telegram(thread, msg, ctx):
    user_prompt = msg.text or ""
    
    # Extract session ID from Telegram sender data
    sender = str(getattr(msg, "sender", None))
    try:
        session_data = sender.split()
        session_id = session_data[1].lstrip(r"'").rstrip(r"',")
    except:
        session_id = f"tg_{hash(sender)}"

    # 1. Process via core engine
    json_payload = process_medibot_query(user_prompt, session_id)
    
    # 2. Convert JSON to Telegram readable text
    final_text = format_telegram_reply(json_payload)
    
    # 3. Post back to user
    thread.post(final_text)
    
    # Also print to terminal for logging
    print("\n📦 --- TELEGRAM PROCESSED PAYLOAD ---")
    print(json.dumps(json_payload, indent=2))




if __name__ == "__main__":
    print("🚀 MediBot Caspian Bot Booted. Listening on Telegram...")
    cx.run()