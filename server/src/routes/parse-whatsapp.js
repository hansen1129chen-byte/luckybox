const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

router.post('/', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ message: 'No text provided' });

    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `You are a Nigerian address parser. Extract these fields from WhatsApp order messages:
- name: customer's full name
- gender: infer from name — "male", "female", or "" if unsure. Nigerian male name clues: Abdulmalik, Ibrahim, Emmanuel, Yusuf, Chukwudi. Female name clues: Zainab, Fatima, Amaka, Chioma, Blessing, Adenike, Mary.
- phone: Nigerian phone number (starting with 080/081/070/090 or +234)
- address: full delivery address including landmarks, local govt area, state
Return ONLY valid JSON: {"name":"...","gender":"male|female|","phone":"...","address":"..."}
If a field cannot be found, use empty string "". Do NOT include any other text.`
          },
          { role: 'user', content: text }
        ],
        temperature: 0,
        max_tokens: 300,
      }),
    });

    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    const json = JSON.parse(raw.replace(/```json\s*|\s*```/g, '').trim());

    let phone = (json.phone || '').replace(/\s+/g, '').trim();
    if (phone.startsWith('234') && !phone.startsWith('+234')) phone = '0' + phone.slice(3);

    res.json({
      name: json.name || '',
      gender: json.gender || '',
      phone,
      address: json.address || '',
    });
  } catch (err) {
    console.error('[Parse WhatsApp]', err);
    res.status(500).json({ message: 'Parse failed' });
  }
});

module.exports = router;
