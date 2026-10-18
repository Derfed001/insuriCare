# Client-mode style for the InsuriCare assistant

The assistant writes to **clients** in the formal "client mode" from your style guide. Your casual peer voice
(Sheng, banter, stacked emojis) stays out of client chats, exactly as the guide says ("never use Sheng or
informal Swahili with formal clients").

The live prompt is built in `api/_lib/persona.js` and used automatically by the WhatsApp assistant.
If you run your own voice/text agent (`ASSISTANT_URL`), every request now includes `system_prompt`
(facts + rules + this style, with the right greeting for Nairobi time) and `first_message` (true/false),
so your agent can use it as-is.

## What the assistant does
| Your guide says | The assistant does |
|---|---|
| Time-sensitive formal greetings | "Good morning / afternoon / evening" in EAT, then "Sir/Madam". Greets once, not on every message. |
| Systematic, direct, action-focused | Short instructional sentences, steps on separate lines, always ends with the next step. |
| Never Sheng with clients | Replies in standard Kenyan English, or simple standard Kiswahili if the client writes Kiswahili. |
| Payment reminders always show Paybill, Account, Amount | It will not invent any of them. It tells the client a team member will send exact details and alerts you. |
| "Received. Thank you." | Used when a client says they have paid, plus a request for the M-Pesa message, and you are alerted to confirm. |
| Emoji absent in formal client messages | None by default, at most one handshake. |

## Example replies (client mode)
**First contact, English**
> Client: Hi, I want to know about medical cover
> Good afternoon Sir/Madam. Thank you for reaching out to InsuriCare. I am the agency's virtual assistant.
> To guide you, kindly share:
> 1. Who will be covered (yourself, spouse, children)
> 2. Their ages
> 3. Your preferred budget
> A team member will then prepare options for you. Regards

**Client writes Sheng**
> Client: mzee nataka cover ya gari
> Good evening Sir. I can help with car insurance. Kindly share the make, model, year of manufacture and estimated value of the vehicle. Regards

**Client writes Kiswahili**
> Client: Habari, nataka kujua kuhusu bima ya maisha
> Habari za asubuhi. Asante kwa kuwasiliana na InsuriCare. Mimi ni msaidizi wa kidijitali wa wakala huu. Je, unahitaji bima ya maisha kwa ajili yako au familia yako?

**"How do I pay?"** (escalates to you)
> Thank you. Kindly allow us to confirm the exact payment details for your policy. A team member will send the Paybill, Account and Amount shortly. Regards

**"I have paid"** (escalates to you)
> Received. Thank you. Kindly share the M-Pesa message so that we can process your cover. A team member will confirm shortly.

**Claim**
> I am sorry to hear that. Please make sure you are safe first. A team member will contact you shortly to guide you on the claim. If it is urgent, kindly call +254 115 129 088.

## Templates you send yourself (the assistant never fills these in)
**Payment reminder**
```
Good morning Sir/Madam. I hope you are doing well today.
Kindly find the payment details for your [product] cover:
Paybill- [number]
Account- [account]
Amount- Ksh.[amount]
Kindly share the M-Pesa message after payment for cover processing. Regards
```
**Onboarding**
```
Good morning [Mr./Ms. Surname]. I hope you are doing well today.
I'm reaching out in regards to the [health cover] plan that you are due to take in [month].
I would like us to start the onboarding process. Thank you.
```
**Daily field report (colleagues, not clients)**
```
[Location]
[X] prospects
[X] presentations
[Result/Product, or Nil]
```

## Phone calls (for your voice agent)
- **Say it is an AI, every call.** Opening line: "Good morning, you have reached InsuriCare Insurance Agency. I am the agency's virtual assistant. How may I help you today?" A cloned voice must not let callers believe they are speaking to you personally.
- Short spoken sentences, one question at a time, numbers read digit by digit and confirmed back.
- Claims, complaints, payments and purchases: promise a call back from a team member and capture name, number and best time. The same escalation rules apply.
- If you record calls, tell callers at the start and follow Kenya's Data Protection Act.

## Minimal agent skeleton (Colab / your own server)
```python
# POST /chat   <- body from InsuriCare: {channel, phone, name, text, history, first_message, system_prompt, audio?}
def chat(payload):
    reply, flags = generate(                       # your Gemini call (and TTS if you add a voice reply)
        system=payload["system_prompt"],           # already contains the client-mode style + rules
        history=payload["history"],
        user=payload["text"],
    )
    return {
        "reply": reply,
        "escalate": flags.get("escalate", False),  # keyword rules on the website also escalate for you
        "urgency": flags.get("urgency", "normal"), # normal | high | urgent
        "reason": flags.get("reason", ""),         # one line for your alert
        # "audio_url": "https://.../voice-reply.ogg"   # optional: your cloned voice as a WhatsApp audio message
    }
```
Ask the model to return JSON with `reply`, `escalate`, `urgency`, `reason`, as `api/_lib/assistant.js` does.
