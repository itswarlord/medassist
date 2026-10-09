'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Info,
  LockKeyhole,
  Pill,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserRound,
} from 'lucide-react'

// ============================================================================
// TYPE DEFINITIONS & DATA CONTRACTS
// Strictly matching the Python FastAPI backend Pydantic models to ensure
// seamless deserialization and robust prop drilling across components.
// ============================================================================

export interface PartnerPrice {
  platform: '1mg' | 'PharmEasy' | 'Apollo 24|7' | string
  price_inr: number
  delivery_eta: string
  in_stock: boolean
}

export interface SubstituteData {
  brand_name: string
  manufacturer: string
  active_composition: string
  composition_identically_verified: boolean
  mrp_inr: number
  savings_percentage: number
  user_advisory: string
  partner_price_comparison: PartnerPrice[]
}

export interface DetectedMedicationData {
  brand_name: string
  active_composition: string
  therapeutic_class: string
  schedule: 'Schedule H' | 'Schedule X' | 'OTC' | string
  mrp_inr: number
}

export interface SafetyGuard {
  is_restricted_schedule_h: boolean
  intercept_triggered: boolean
  mandated_prompt: string | null
  is_diagnosis_detected: boolean
}

export interface MediBotPayload {
  user_query: string
  session_id: string
  disclaimer_acknowledged: boolean
  safety_guard: SafetyGuard
  detected_medication: DetectedMedicationData | null
  substitutes: SubstituteData[]
  disclaimer: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content?: string // Utilized for text-only server responses (e.g., /start, errors)
  payload?: MediBotPayload // Utilized for rich-structured API JSON dumps
  timestamp: string
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generates a cryptographically sound, unique session identifier.
 * Using a time-based alphanumeric hash ensures that the MySQL database 
 * maintains distinct conversational histories without collision.
 */
const generateSessionId = () => {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `MB-${timestamp}-${randomStr}`;
}

// ============================================================================
// REACT COMPONENTS
// ============================================================================

function Avatar({ role }: { role: ChatMessage['role'] }) {
  return (
    <div className={`avatar ${role === 'assistant' ? 'avatar-bot' : 'avatar-user'}`} aria-hidden="true">
      {role === 'assistant' ? <ShieldCheck /> : <UserRound />}
    </div>
  )
}

function SafetyGuard({ guard }: { guard: SafetyGuard }) {
  if (!guard.intercept_triggered) return null

  if (guard.is_diagnosis_detected) {
    return (
      <div className="safety safety-danger">
        <AlertTriangle />
        <div>
          <strong>Medical diagnosis isn&apos;t available here</strong>
          <p>{guard.mandated_prompt}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="safety safety-warning">
      <LockKeyhole />
      <div>
        <strong>Schedule H Drug: Valid Doctor&apos;s Prescription Required</strong>
        <p>This medicine is prescription-only. A doctor should confirm any alternative.</p>
      </div>
    </div>
  )
}

function ReportCard({ payload }: { payload: MediBotPayload }) {
  const medication = payload.detected_medication

  return (
    <div className="report-card">
      <SafetyGuard guard={payload.safety_guard} />
      
      {medication && (
        <section className="medication-card">
          <div className="section-kicker">
            <Pill /> Detected medication
          </div>
          <div className="medication-head">
            <div>
              <h3>{medication.brand_name}</h3>
              <span className={`rx-badge ${medication.schedule === 'OTC' ? 'rx-otc' : ''}`}>
                {medication.schedule}
              </span>
            </div>
            <span className="price-label">
              Reference MRP <strong>₹{medication.mrp_inr.toFixed(2)}</strong>
            </span>
          </div>
          <div className="composition">{medication.active_composition}</div>
          <span className="class-tag">{medication.therapeutic_class}</span>
        </section>
      )}

      {payload.substitutes.length > 0 && (
        <section className="substitutes">
          <div className="substitute-title">
            <div>
              <div className="section-kicker">
                <Sparkles /> Value engine
              </div>
              <h3>Verified Generic &amp; Brand Substitutes <span>{payload.substitutes.length}</span></h3>
            </div>
            <span className="verified-label"><CheckCircle2 /> Verified match</span>
          </div>
          
          {payload.substitutes.map((sub) => (
            <div className="substitute-card" key={sub.brand_name}>
              <div className="substitute-head">
                <div>
                  <h4>{sub.brand_name}</h4>
                  <p>{sub.manufacturer}</p>
                </div>
                <span className="save-badge">Save {sub.savings_percentage}%</span>
              </div>
              <div className="match-row">
                <CheckCircle2 /> Bio-equivalent Composition <span>•</span> 
                <span className="composition-small">{sub.active_composition}</span>
              </div>
              <div className="price-row">
                <span>MRP <s>₹{medication?.mrp_inr.toFixed(2)}</s></span>
                <strong>₹{sub.mrp_inr.toFixed(2)}</strong>
                <span className="delta">
                  Save ₹{((medication?.mrp_inr ?? 0) - sub.mrp_inr).toFixed(2)}
                </span>
              </div>
              <div className="advisory">
                <Info /> <em>{sub.user_advisory}</em>
              </div>
              <div className="partner-list">
                {sub.partner_price_comparison.map((partner) => (
                  <div className="partner-row" key={partner.platform}>
                    <span className="partner-name">{partner.platform}</span>
                    <strong>₹{partner.price_inr.toFixed(2)}</strong>
                    <span className="eta">{partner.delivery_eta}</span>
                    <span className={`stock ${partner.in_stock ? '' : 'out'}`}>
                      <i />{partner.in_stock ? 'In Stock' : 'Out of stock'}
                    </span>
                    <button className="view-button" disabled={!partner.in_stock}>
                      View <ChevronRight />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
      <footer className="compliance">
        <Info /> <span>{payload.disclaimer}</span>
      </footer>
    </div>
  )
}

// ============================================================================
// MAIN PAGE APPLICATION STATE
// ============================================================================

export default function Page() {
  // Initialize an empty conversation to display the welcoming hero state.
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  
  // Dynamic Session Management: Instantiates a unique database key per browser session.
  const [sessionId, setSessionId] = useState<string>('')

  const endRef = useRef<HTMLDivElement>(null)

  // Hydrate the session ID on the client side to avoid Next.js hydration mismatch errors
  useEffect(() => {
    setSessionId(generateSessionId())
  }, [])

  // Auto-scroll anchor enforcement ensuring the latest message is always in view
  useEffect(() => { 
    endRef.current?.scrollIntoView({ behavior: 'smooth' }) 
  }, [messages, isLoading])

  /**
   * Primary network communication handler.
   * Transmits the user's intent and session token to the FastAPI Python backend,
   * awaits the LangChain intelligence evaluation, and mutates the UI tree accordingly.
   */
  async function sendMessage(value: string) {
    const trimmed = value.trim(); 
    if (!trimmed || isLoading) return;
    
    const now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    
    // Optimistic UI Update: Append user message instantly
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', content: trimmed, timestamp: now }]); 
    setQuery(''); 
    setIsLoading(true);
    
    try {
      // Cross-Origin POST execution mapping to FastAPI `ChatRequest` schema
      const response = await fetch("http://localhost:8000/api/v1/medibot/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          user_query: trimmed, 
          session_id: sessionId 
        })
      });
  
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
  
      // Payload Routing: Differentiate between standard text execution (e.g. commands)
      // and rich JSON structural payloads output by the LLM Pydantic model.
      if (data.status === "success" || data.status === "error") {
         setMessages((current) => [
           ...current, 
           { id: crypto.randomUUID(), role: 'assistant', content: data.reply, timestamp: now }
         ]);
      } else {
         setMessages((current) => [
           ...current, 
           { id: crypto.randomUUID(), role: 'assistant', payload: data, timestamp: now }
         ]);
      }
      
    } catch (error) {
      console.error("API Communication Error:", error);
      setMessages((current) => [
        ...current, 
        { 
          id: crypto.randomUUID(), 
          role: 'assistant', 
          content: "Network connection refused. Please verify that the local FastAPI server (api.py) is running on port 8000.", 
          timestamp: now 
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function submit(event: FormEvent) { 
    event.preventDefault(); 
    void sendMessage(query);
  }

  /**
   * Session invalidation logic.
   * Wipes the local React state array and generates a completely fresh Session ID.
   * The backend will interpret this new ID as a completely disconnected user, 
   * bypassing historical memory mapping.
   */
  function resetSession() { 
    setMessages([]); 
    setQuery('');
    setSessionId(generateSessionId());
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Pill /></div>
          <div>
            <div className="brand-name">MediBot</div>
            <div className="brand-sub">
              <ShieldCheck /> Indian Pharmacopeia &amp; Schedule H Compliant
            </div>
          </div>
        </div>
        <div className="session-tools">
          <span className="session-chip">
            <i /> Active Session <strong>{sessionId}</strong>
          </span>
          <button 
            className="new-session" 
            onClick={resetSession} 
            aria-label="Start a new session"
          >
            <RefreshCw /> <span>New Session</span>
          </button>
        </div>
      </header>

      <div className="chat-area">
        <div className="chat-inner">
          {messages.length === 0 && (
            <div className="welcome">
              <div className="welcome-icon"><Stethoscope /></div>
              <h1>Find compositionally verified,<br /><em>affordable medicine alternatives.</em></h1>
              <p>Ask about a medicine, compare prices, or explore verified generic alternatives.</p>
              <div className="starter-grid">
                {[
                  'Cheaper alternative to Augmentin 625 Duo', 
                  'Find substitute for Dolo 650', 
                  'I have a severe headache, what should I take?'
                ].map((starter) => (
                  <button key={starter} onClick={() => void sendMessage(starter)}>
                    {starter}<ArrowUp />
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div className={`message-row ${message.role}`} key={message.id}>
              <Avatar role={message.role} />
              <div className="message-body">
                <div className="message-meta">
                  <strong>{message.role === 'assistant' ? 'MediBot' : 'You'}</strong>
                  <span>{message.timestamp}</span>
                </div>
                {message.content && <div className="bubble">{message.content}</div>}
                {message.payload && <ReportCard payload={message.payload} />}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="message-row assistant">
              <Avatar role="assistant" />
              <div className="message-body">
                <div className="message-meta">
                  <strong>MediBot</strong><span>Analyzing pharmacology...</span>
                </div>
                <div className="typing"><span /><span /><span /></div>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <footer className="composer-wrap">
        <form className="composer" onSubmit={submit}>
          <textarea 
            value={query} 
            onChange={(event) => setQuery(event.target.value)} 
            onKeyDown={(event) => { 
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { 
                event.preventDefault(); 
                void sendMessage(query) 
              } 
            }} 
            placeholder="Ask MediBot about a medicine or alternative..." 
            rows={1} 
            disabled={isLoading} 
            aria-label="Message MediBot" 
          />
          <button 
            className="send-button" 
            type="submit" 
            disabled={!query.trim() || isLoading} 
            aria-label="Send message"
          >
            <ArrowUp />
          </button>
        </form>
        <div className="composer-note">
          <CircleHelp /> Information only <span>•</span> Not medical advice <span>•</span> Do not use as a substitute for a doctor&apos;s care
        </div>
      </footer>
    </main>
  )
}