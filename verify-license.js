const admin = require('firebase-admin');

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
    const { licenseKey } = JSON.parse(event.body);

    if (!licenseKey || !licenseKey.startsWith('SOFT-')) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ valid: false, reason: 'Invalid key format' }),
      };
    }

    const snapshot = await db.collection('soft_licenses')
      .where('licenseKey', '==', licenseKey.trim().toUpperCase())
      .where('active', '==', true)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ valid: false, reason: 'Key not found' }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ valid: true }),
    };

  } catch (err) {
    console.error('Verify error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ valid: false, reason: 'Server error' }),
    };
  }
};
