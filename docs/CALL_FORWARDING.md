# Forward your phone to the assistant

Goal: when **+254703445018** is busy, not answered, or switched off / out of signal, the call goes to your
Africa's Talking voice number and **Makokha** (the AI assistant) answers, helps, or takes a message.
You then get a short SMS about the call.

## 1. What you need first
1. A **live** Africa's Talking app with a **voice number** (Voice -> Phone Numbers). The sandbox has no voice.
   Ask Africa's Talking support about Kenya number availability, verification, and the monthly and per-minute fees.
2. These variables in Vercel (then Redeploy):

| Name | Value |
|---|---|
| `AT_USERNAME`, `AT_API_KEY`, `AT_WEBHOOK_SECRET` | from Africa's Talking, and your own secret string |
| `AT_VOICE_NUMBER` | your Africa's Talking voice number, e.g. `+2547XXXXXXXX` |
| `CALL_FORWARDED` | `1` |
| `OWNER_NAME` | your first name (the greeting says "<name> is not available to take your call right now") |
| `OWNER_PHONE` | `+254703445018` (summary and alert SMS go here) |

3. In Africa's Talking set the voice number's **Callback URL** to  
   `https://YOUR-SITE.vercel.app/api/at-voice?key=YOUR_SECRET`

`CALL_FORWARDED=1` means this voice number is only the target of your forwarding. Callers skip the menu and
the assistant answers straight away. The "press 0 to speak to a team member" option is switched off, because
it would ring your phone and your phone would forward the call straight back.
If you also want to give clients a number with the menu, use a second voice number for that.

## 2. Set up forwarding on the SIM +254703445018
Use the voice number from step 1 in international form, shown below as `+254XXXXXXXXX`.

**Android (easiest):** Phone app -> menu -> Settings -> Calls -> Call forwarding (the name varies). Set
*When busy*, *When unanswered* and *When unreachable* to the voice number. On a dual-SIM phone pick the
SIM that has +254703445018.

**iPhone:** Settings -> Phone -> Call Forwarding only forwards *every* call. For busy / unanswered / unreachable,
dial the codes below from the Phone app instead.

**Dial these codes** (they are the standard GSM codes; they normally work on Safaricom, and you can check with
Safaricom if one is refused):

| Situation | Dial |
|---|---|
| When busy | `**67*+254XXXXXXXXX#` |
| When not answered (after 20 seconds) | `**61*+254XXXXXXXXX**20#` |
| When unreachable (off or no signal) | `**62*+254XXXXXXXXX#` |

Use 5 to 30 seconds in steps of 5 for the unanswered delay. 20 gives you time to pick up.

**Check what is set:** `*#67#`, `*#61#`, `*#62#`  
**Turn one off:** `##67#`, `##61#`, `##62#`  
**Turn all forwarding off** (for example when you can take calls again): `##002#`

## 3. Test it (use a second phone)
1. Switch your phone to airplane mode and call +254703445018. You should hear: "Good morning, you have reached <your name>'s line at InsuriCare Insurance Agency ... I am Makokha, the agency's virtual assistant ... This call is recorded."
2. Say something like "I want to know about life insurance", then press `#`. The assistant answers.
3. Hang up. Within a minute you should get an SMS such as "Makokha handled a call from +254...".
4. Repeat with your phone on (let it ring out), and while you are on another call (busy).
5. Say "I had an accident" on a test call: you should get an urgent alert straight away.

## 4. How it behaves
- It always says it is an AI and that the call is recorded. Recordings are kept by Africa's Talking.
- A routine call does not interrupt you. You get one short SMS after the call.
- Claims, accidents, complaints, buying and "please call me back" are sent to you as alerts while the caller is still on the line, and the caller is told a team member will call back.
- If nobody speaks, the call ends politely and you get a "missed call" SMS with the caller's number.
- Calls are turn-based (the assistant answers a few seconds after the caller stops), not instant.
- A call that comes from your own voice number is rejected, so forwarding can never loop.

## 5. Costs and limits
- Africa's Talking charges for the voice number and the minutes. Your carrier may also charge you for the forwarded leg of each call. Check both before you switch it on.
- Only normal phone calls are forwarded. WhatsApp calls are not.
- The voice line normally sees the original caller's number. If your summary SMS shows your own number or "unknown number", the carrier is hiding it: tell me and I will make the assistant ask callers for their number.
- Forwarding stays on until you cancel it. Use `##002#` when you want calls to ring you again.
