const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

// Nigeria area data for reverse lookup
let areaData = [];
const path = require('path');
const fs = require('fs');
try {
  const dataPath = path.join(__dirname, '..', '..', '..', 'client', 'public', 'nigeria-areas.json');
  areaData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
} catch (e) { console.log('[Parse] Area data load skipped:', e.message); }

function fillFromLookup(json) {
  // If city given but province missing: find which state has this LGA
  if (json.city && !json.province) {
    for (const s of areaData) {
      if (s.lgas?.some(l => l.name.toLowerCase() === json.city.toLowerCase())) {
        json.province = s.state; break;
      }
    }
  }
  // If district given but city missing: find which LGA has this ward
  if (json.district && !json.city) {
    for (const s of areaData) {
      for (const l of (s.lgas || [])) {
        if (l.wards?.some(w => w.name.toLowerCase() === json.district.toLowerCase())) {
          json.city = l.name;
          if (!json.province) json.province = s.state;
          return json;
        }
      }
    }
  }
  return json;
}

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
- gender: infer from name — "male", "female", or "" if unsure
- phone: primary Nigerian phone number (080/081/070/090 or +234)
- phone2: secondary/alternate Nigerian phone number (different from phone), empty if none
- address: street-level delivery address ONLY (building number, street name, landmarks). Do NOT include city, state, or LGA names in this field.
- province: Nigerian state name (e.g. Lagos, Abia, Abuja FCT, Rivers, Kano)
- city: local government area / city name (e.g. Ikeja, Alimosho, Surulere)
- district: neighborhood/ward/area name (e.g. Alausa, Victoria Island, Ajah)
Return ONLY valid JSON: {"name":"...","gender":"male|female|","phone":"...","phone2":"...","address":"...","province":"...","city":"...","district":"..."}
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
    const json = fillFromLookup(JSON.parse(raw.replace(/```json\s*|\s*```/g, '').trim()));

    let phone = (json.phone || '').replace(/\s+/g, '').trim();
    if (phone.startsWith('234') && !phone.startsWith('+234')) phone = '0' + phone.slice(3);

    let phone2 = (json.phone2 || '').replace(/\s+/g, '').trim();
    if (phone2.startsWith('234') && !phone2.startsWith('+234')) phone2 = '0' + phone2.slice(3);

    res.json({
      name: json.name || '',
      gender: json.gender || '',
      phone,
      phone2,
      address: json.address || '',
      province: json.province || 'LAGOS',
      city: json.city || 'LAGOS',
      district: json.district || 'LAGOS',
    });
  } catch (err) {
    console.error('[Parse WhatsApp]', err);
    res.status(500).json({ message: 'Parse failed' });
  }
});

module.exports = router;
