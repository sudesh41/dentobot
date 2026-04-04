const express = require('express');
const axios = require('axios');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));

const VOICEFLOW_API_KEY = process.env.VOICEFLOW_API_KEY;
const SHEETY_URL = process.env.SHEETY_URL;
const sessions = {};

// Store conversation state per user
const bookingData = {};

const saveBooking = async (data) => {
  if (!SHEETY_URL) return;
  try {
    await axios.post(SHEETY_URL, {
      sheet1: {
        timestamp: new Date().toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata'
        }),
        patientPhone: data.phone,
        name: data.name || 'Not provided',
        preferredTime: data.time || 'Not provided',
        concern: data.concern || 'Not provided',
        status: 'New'
      }
    });
    console.log('Booking saved:', data.phone);
  } catch (e) {
    console.log('Sheet error:', e.message);
  }
};

// Extract booking details from conversation
const extractBookingInfo = (message, botReply, phone) => {
  if (!bookingData[phone]) {
    bookingData[phone] = {};
  }

  const lowerReply = botReply.toLowerCase();
  const lowerMsg = message.toLowerCase();

  // Detect name being collected
  if (lowerReply.includes('mobile number') || 
      lowerReply.includes('phone number')) {
    bookingData[phone].name = message;
  }

  // Detect phone number being collected
  if (/\d{10}/.test(message)) {
    bookingData[phone].phone_given = message;
  }

  // Detect time preference
  if (lowerMsg === 'morning' || 
      lowerMsg === 'afternoon' || 
      lowerMsg === 'evening') {
    bookingData[phone].time = message;
  }

  // Detect concern/service
  if (lowerReply.includes('confirm') && 
      lowerReply.includes('noted')) {
    bookingData[phone].concern = message;
  }
};

// Detect if booking is confirmed
const isBookingConfirmed = (botReply) => {
  const lower = botReply.toLowerCase();
  return lower.includes('your request has been noted') ||
         lower.includes('appointment request has been') ||
         lower.includes('see you at dento') ||
         lower.includes("see you at dent o'clock");
};

app.post('/webhook', async (req, res) => {
  const incomingMsg = req.body.Body;
  const fromNumber = req.body.From;
  const sessionId = fromNumber.replace('whatsapp:+', '');
  const cleanPhone = fromNumber.replace('whatsapp:+', '+');

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
    extractBookingInfo(incomingMsg, messages, cleanPhone);

    // Save to sheet only when booking is confirmed
    if (isBookingConfirmed(messages)) {
      await saveBooking({
        phone: cleanPhone,
        name: bookingData[cleanPhone]?.name,
        time: bookingData[cleanPhone]?.time,
        concern: bookingData[cleanPhone]?.concern
      });
      // Reset booking data for this user
      delete bookingData[cleanPhone];
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
