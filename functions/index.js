/**
 * Import function triggers from their respective sub-packages.
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */
const {onCall} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler"); // Modern syntax for scheduled functions
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {google} = require("googleapis");
const functions = require("firebase-functions");

initializeApp();

// Helper function to initialize OAuth2 client
const getOauth2Client = () => {
  return new google.auth.OAuth2(
      functions.config().google.client_id,
      functions.config().google.client_secret,
      // This must match the URI in your Google Cloud Console credentials
      `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/oauthcallback`,
  );
};

/**
 * Generates a Google Auth URL for the user to grant permissions.
 */
exports.getGoogleAuthUrl = onCall((request) => {
  const oauth2Client = getOauth2Client();

  // Scopes define the level of access you are requesting
  const scopes = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    // A unique identifier for the user's session
    state: request.auth.uid,
  });

  return {url};
});

/**
 * Handles the OAuth callback from Google, exchanges the code for tokens,
 * and saves them securely.
 */
exports.oauthcallback = functions.https.onRequest(async (req, res) => {
  const code = req.query.code;
  const userId = req.query.state; // We passed the UID in the state parameter

  if (!code || !userId) {
    return res.status(400).send("Missing authorization code or user state.");
  }

  try {
    const oauth2Client = getOauth2Client();
    const {tokens} = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Securely store the tokens for the user
    // NOTE: In a production app, encrypt these tokens before storing.
    const db = getFirestore();
    const userRef = db.collection("users").doc(userId);

    await userRef.update({
      "integrations.google.tokens": tokens,
      "integrations.google.status": "connected",
    });

    // You can redirect the user back to your app with a success message
    return res.redirect("https://fearless-leader.web.app?integration=success");
  } catch (error) {
    console.error("Error exchanging auth code for tokens:", error);
    return res.status(500).send("Authentication failed.");
  }
});

/**
 * A scheduled function to sync calendar events.
 * This function will run automatically on a defined schedule.
 * THIS IS THE CORRECTED V2 SYNTAX
 */
exports.syncCalendarEvents = onSchedule("every 15 minutes", async (event) => {
  const db = getFirestore();
  // Find all users who have connected their Google account
  const usersSnapshot = await db.collection("users")
      .where("integrations.google.status", "==", "connected")
      .get();

  if (usersSnapshot.empty) {
    console.log("No users with active Google integrations.");
    return null;
  }

  for (const userDoc of usersSnapshot.docs) {
    const userData = userDoc.data();
    const tokens = userData.integrations.google.tokens;
    const companyId = userData.companyId;

    if (!tokens || !companyId) {
      continue; // Skip if tokens or companyId are missing
    }

    const oauth2Client = getOauth2Client();
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({version: "v3", auth: oauth2Client});

    try {
      // Fetch events from the primary calendar for the next 24 hours
      const response = await calendar.events.list({
        calendarId: "primary",
        timeMin: (new Date()).toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = response.data.items;
      if (!events || events.length === 0) {
        console.log(`No upcoming events for user ${userDoc.id}.`);
        continue;
      }

      // In a real app, you would add logic here to check for duplicates
      // before adding new items to the inbox.
      const inboxRef = db.collection(`companies/${companyId}/inbox`);
      for (const event of events) {
        await inboxRef.add({
          type: "Google Calendar",
          title: event.summary,
          details: event.description || "No details provided.",
          sourceId: event.id,
          createdAt: new Date(),
        });
      }
      console.log(`Synced ${events.length} events for user ${userDoc.id}.`);
    } catch (error) {
      console.error(`Failed to sync calendar for user ${userDoc.id}:`,
          error,
      );
      // If refresh token is invalid, update user status
      if (error.code === 401) {
        await userDoc.ref.update({
          "integrations.google.status": "disconnected",
        });
      }
    }
  }
  return null;
});