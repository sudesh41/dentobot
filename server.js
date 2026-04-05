const express = require('express');
const axios = require('axios');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));

const VOICEFLOW_API_KEY = process.env.VOICEFLOW_API_KEY;
const SHEETY_URL = process.env.SHEETY_URL;
const MAPS_LINK = 'https://maps.app.goo.gl/yourShortLinkHere';

const sessions = {};

const saveBooking = async (data) => {
  if (!SHEETY_URL) return;
  try {
    await axios.post(SHEETY_URL, {
      sheet1: {
        timestamp: new Date().toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata'
        }),
        patientPhone: data.patientPhone || 'Not provided',
        name: data.name || 'Not provided',
        preferredTime: data.time || 'Not provided',
        concern: data.concern || 'Not provided',
        appointmentDate: data.date || 'Not provided',
        status: 'New'
      }
    });
    console.log('Booking saved:', data);
  } catch (e) {
    console.log('Sheet error:', e.message);
  }
};

// Extract all booking details from the confirmation message itself
const parseConfirmationMessage = (botReply) => {
  const data = {};

  // Extract name — "Thank you [Name]!" or "Thank you, [Name]"
  const nameMatch = botReply.match(
    /thank you[,\s]+([A-Za-z\s]+?)[\!\.\,]/i
  );
  if (nameMatch) {
    data.name = nameMatch[1].trim();
  }

  // Extract phone — 10 digit number in the confirmation
  const phoneMatch = botReply.match(/\b(\d{10})\b/);
  if (phoneMatch) {
    data.patientPhone = phoneMatch[1];
  }

  // Extract date — "Date: 7th April" or "Date: tomorrow"
  const dateMatch = botReply.match(/date[:\s]+([^\n]+)/i);
  if (dateMatch) {
    data.date = dateMatch[1].trim();
  }

  // Extract time — "Time: Afternoon"
  const timeMatch = botReply.match(/time[:\s]+([^\n]+)/i);
  if (timeMatch) {
    data.time = timeMatch[1].trim();
  }

  // Extract concern — "Concern: Just general checkup"
  const concernMatch = botReply.match(/concern[:\s]+([^\n]+)/i);
  if (concernMatch) {
    data.concern = concernMatch[1].trim();
  }

  return data;
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

  // Handle location request directly
  if (isLocationRequest(incomingMsg)) {
    const locationReply =
      `Here is our clinic location on Google Maps:\n\n` +
      `${MAPS_LINK}\n\n` +
      `DentO'clock Dental Care\n` +
      `Raidurg, Hyderabad, Telangana\n` +
      `Phone: +91 7670980925\n\n` +
      `Walk-ins welcome, appointment recommended. ` +
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

    // When booking confirmed, parse details from confirmation message
    if (isBookingConfirmed(messages)) {
      const bookingDetails = parseConfirmationMessage(messages);
      console.log('Parsed booking:', bookingDetails);
      await saveBooking(bookingDetails);
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
