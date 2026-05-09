const admin = require('firebase-admin');
const { Resend } = require('resend');

// Init Firebase (only once)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();
const resend = new Resend(process.env.RESEND_API_KEY);

function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `SOFT-${seg()}-${seg()}-${seg()}`;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method not allowed' };
  }

  try {
    const payload = JSON.parse(event.body);

    // Dodo sends payment.succeeded event
    const eventType = payload.type || payload.event_type;
    if (!eventType || !eventType.includes('payment') && !eventType.includes('order')) {
      return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
    }

    // Extract customer info from Dodo webhook payload
    const data = payload.data || payload;
    const customerEmail =
      data.customer?.email ||
      data.billing?.email ||
      data.email ||
      null;

    const orderId = data.id || data.order_id || data.payment_id || 'unknown';

    if (!customerEmail) {
      console.error('No customer email found in payload:', JSON.stringify(payload));
      return { statusCode: 200, headers, body: JSON.stringify({ received: true, warning: 'no email' }) };
    }

    // Check if license already issued for this order
    const existing = await db.collection('soft_licenses')
      .where('orderId', '==', orderId)
      .limit(1)
      .get();

    if (!existing.empty) {
      return { statusCode: 200, headers, body: JSON.stringify({ received: true, note: 'already issued' }) };
    }

    // Generate and store license key
    const licenseKey = generateLicenseKey();
    await db.collection('soft_licenses').add({
      licenseKey,
      email: customerEmail,
      orderId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      active: true,
    });

    // Send email with license key
    await resend.emails.send({
      from: 'Soft <noreply@withsoft.dev>',
      to: customerEmail,
      subject: 'Your Soft Pro License Key',
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
          <div style="background: #D4E157; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 24px;">
            <span style="font-size: 18px; font-weight: 800; color: #0A0A0A;">S</span>
          </div>
          <h1 style="font-size: 22px; font-weight: 800; color: #0A0A0A; margin: 0 0 8px;">Welcome to Soft Pro</h1>
          <p style="font-size: 15px; color: #555555; margin: 0 0 32px;">Here is your license key. Keep it safe.</p>

          <div style="background: #F0F0F0; border: 1px solid #D0D0D0; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 32px;">
            <div style="font-size: 11px; font-weight: 700; color: #888888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Your License Key</div>
            <div style="font-size: 22px; font-weight: 800; color: #0A0A0A; letter-spacing: 2px;">${licenseKey}</div>
          </div>

          <div style="margin-bottom: 32px;">
            <p style="font-size: 14px; font-weight: 700; color: #0A0A0A; margin: 0 0 12px;">How to activate:</p>
            <ol style="font-size: 14px; color: #555555; padding-left: 20px; margin: 0; line-height: 2;">
              <li>Open the Soft extension in Chrome</li>
              <li>Click the <strong>Pro</strong> tab</li>
              <li>Paste your license key and click <strong>Activate</strong></li>
            </ol>
          </div>

          <p style="font-size: 13px; color: #888888; margin: 0;">Questions? Reply to this email and we will help.</p>
        </div>
      `,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'License issued and emailed' }),
    };

  } catch (err) {
    console.error('Webhook error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
