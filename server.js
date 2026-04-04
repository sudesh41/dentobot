const express = require('express');
const axios = require('axios');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));

const VOICEFLOW_API_KEY = process.env.VOICEFLOW_API_KEY;
const SHEETY_URL = process.env.SHEETY_URL;

// Google Maps link for DentO'Clock
const MAPS_LINK = 'https://maps.app.goo.gl/EK6RcwcDWV7um2M29';

const sessions = {};
const bookingData = {};

const saveBooking = async (data) => {
  if (!SHEETY_URL) return;
  try {
    await axios.post(SHEETY_URL, {
      sheet1: {
        timestamp: new Date().toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata'
        }),
        patientPhone: data.patientPhone,
        name: data.name || 'Not provided',
        preferredTime: data.time || 'Not provided',
        concern: data.concern || 'Not provided',
        status: 'New'
      }
    });
    console.log('Booking saved for:', data.patientPhone);
  } catch (e) {
    console.log('Sheet error:', e.message);
  }
};

const extractBookingInfo = (message, botReply, sessionId) => {
  if (!bookingData[sessionId]) {
    bookingData[sessionId] = {};
  }

  const lowerReply = botReply.toLowerCase();
  const lowerMsg = message.toLowerCase().trim();

  // Extract name — bot just asked for mobile number
  if (lowerReply.includes('mobile number') ||
      lowerReply.includes('phone number') ||
      lowerReply.includes('share your mobile')) {
    bookingData[sessionId].name = message;
  }

  // Extract phone number — 10 digit number typed by patient
  if (/^\d{10}$/.test(message.trim())) {
    bookingData[sessionId].patientPhone = message.trim();
  }

  // Extract time preference
  if (['morning', 'afternoon', 'evening'].includes(lowerMsg)) {
    bookingData[sessionId].time = message;
  }

  // Extract concern — last message before confirmation
  if (lowerReply.includes('your request has been noted') ||
      lowerReply.includes('see you at dento') ||
      lowerReply.includes("see you at dent o'clock")) {
    bookingData[sessionId].concern = message;
  }
};

const isBookingConfirmed = (botReply) => {
  const lower = botReply.toLowerCase();
  return lower.includes('your request has been noted') ||
         lower.includes('see you at dento') ||
         lower.includes("see you at dent o'clock");
};

const isLocationRequest = (message) => {
  const lower = message.toLowerCase();
  return lower.includes('location') ||
         lower.includes('directions') ||
         lower.includes('where are you') ||
         lower.includes('address') ||
         lower.includes('maps') ||
         lower.includes('how to reach') ||
         lower.includes('location pin') ||
         lower.includes('find you');
};

app.post('/webhook', async (req, res) => {
  const incomingMsg = req.body.Body;
  const fromNumber = req.body.From;
  const sessionId = fromNumber.replace('whatsapp:+', '');

  // Handle location request directly — no need to go to Voiceflow
  if (isLocationRequest(incomingMsg)) {
    const locationReply =
      `Here is our clinic location on Google Maps:\n\n` +
      `${MAPS_LINK}\n\n` +
      `DentO'clock Dental Care\n` +
      `Raidurg, Hyderabad, Telangana\n` +
      `Phone: +91 7670980925\n\n` +
      `We're open daily. Walk-ins welcome, ` +
      `appointment recommended to avoid waiting. ` +
      `Is there anything else I can help you with?`;

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(locationReply);
    res.type('text/xml');
    res.send(twiml.toString());
    return;
  }

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

    // Track booking data
    extractBookingInfo(incomingMsg, messages, sessionId);

    // Save to sheet only on confirmed booking
    if (isBookingConfirmed(messages)) {
      const data = bookingData[sessionId] || {};
      await saveBooking({
        patientPhone: data.patientPhone || 'Not provided',
        name: data.name,
        time: data.time,
        concern: data.concern
      });
      delete bookingData[sessionId];
    }

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
