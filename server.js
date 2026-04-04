const express = require('express');
const axios = require('axios');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));

const VOICEFLOW_API_KEY = process.env.VOICEFLOW_API_KEY;
const SHEETY_URL = process.env.SHEETY_URL;
const sessions = {};

// Save to Google Sheets
const saveToSheet = async (phone, message) => {
  if (!SHEETY_URL) return;
  try {
    await axios.post(SHEETY_URL, {
      sheet1: {
        timestamp: new Date().toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata'
        }),
        patientPhone: phone.replace('whatsapp:+', '+'),
        message: message,
        name: '',
        notes: ''
      }
    });
    console.log('Saved to sheet:', phone);
  } catch (e) {
    console.log('Sheet error:', e.message);
  }
};

app.post('/webhook', async (req, res) => {
  const incomingMsg = req.body.Body;
  const fromNumber = req.body.From;
  const sessionId = fromNumber.replace('whatsapp:+', '');

  // Save every message to Google Sheets
  await saveToSheet(fromNumber, incomingMsg);

  // Start new session
  if (!sessions[sessionId]) {
    sessions[sessionId] = true;
    try {
      await axios.post(
        `https://general-runtime.voiceflow.com/state/user/${sessionId}/interact`,
        { action: { type: 'launch' } },
        {
          headers: {
            Authorization: VOICEFLOW_API_KEY,
            versionID: 'production',
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (e) {
      console.log('Launch error:', e.message);
    }
  }

  try {
    const vfResponse = await axios.post(
      `https://general-runtime.voiceflow.com/state/user/${sessionId}/interact`,
      { action: { type: 'text', payload: incomingMsg } },
      {
        headers: {
          Authorization: VOICEFLOW_API_KEY,
          versionID: 'production',
          'Content-Type': 'application/json'
        }
      }
    );

    const messages = vfResponse.data
      .filter(item => item.type === 'text')
      .map(item => item.payload.message)
      .join('\n\n');

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(messages || "Sorry, could you rephrase that?");
    res.type('text/xml');
    res.send(twiml.toString());

  } catch (err) {
    console.error('Error:', err.message);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Something went wrong. Please try again.");
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('DentoBot running');
});
SHEETY_URL = https://api.sheety.co/yourEndpointHere/dentOClockBookings/sheet1
