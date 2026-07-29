// api/birthday-reminders.js
//
// Runs once a day (see vercel.json cron config). Checks the `members` key
// in the app_kv Supabase table for anyone whose birthday is today, and
// emails the admin list via Gmail if there are any.
//
// Required environment variables (set these in Vercel → Project →
// Settings → Environment Variables — never hardcode them in this file):
//   SUPABASE_URL          e.g. https://kxgqahkcvjojtcwrcmey.supabase.co
//   SUPABASE_ANON_KEY      your Supabase anon/publishable key
//   GMAIL_USER              the Gmail address sending the emails, e.g. lightmakarios@gmail.com
//   GMAIL_APP_PASSWORD      a 16-character App Password (NOT your normal Gmail password —
//                            see setup notes below)
//   ADMIN_EMAILS            comma-separated, e.g. "a@x.com,b@x.com,c@x.com"
//   CRON_SECRET             any random string you choose — protects this
//                            endpoint from being triggered by strangers
//
// --- One-time Gmail setup (do this once, in your Google Account) ---
//   1. Turn on 2-Step Verification: myaccount.google.com/security
//   2. Go to myaccount.google.com/apppasswords
//   3. Create an App Password (name it anything, e.g. "Phenom Teens Reminders")
//   4. Copy the 16-character password it gives you — that's GMAIL_APP_PASSWORD
//      (spaces in it don't matter, you can paste it with or without them)

import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  // --- Guard: only Vercel Cron (or someone with the secret) may trigger this ---
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const GMAIL_USER = process.env.GMAIL_USER;
    const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map(e => e.trim())
      .filter(Boolean);

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !GMAIL_USER || !GMAIL_APP_PASSWORD || !ADMIN_EMAILS.length) {
      return res.status(500).json({ error: 'Missing required environment variables' });
    }

    // --- 1. Fetch members from Supabase (app_kv table, key = 'members') ---
    const dbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/app_kv?key=eq.members&select=value`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    if (!dbRes.ok) {
      const text = await dbRes.text();
      return res.status(502).json({ error: 'Supabase fetch failed', detail: text });
    }

    const rows = await dbRes.json();
    const members = rows?.[0]?.value || [];

    // --- 2. Find members whose birthday is today ---
    const today = new Date();
    const todayMonth = today.getMonth() + 1;
    const todayDay = today.getDate();

    const birthdaysToday = members.filter(
      m => m.dobMonth === todayMonth && m.dobDay === todayDay
    );

    // Manual test trigger (from the dashboard button) always sends an email,
    // even with zero real birthdays, so you can confirm delivery works.
    // The automatic daily cron run never passes this param, so it still
    // stays silent on ordinary days.
    const isTest = req.query.test === 'true';

    if (!birthdaysToday.length && !isTest) {
      return res.status(200).json({ message: 'No birthdays today, no email sent.' });
    }

    // --- 3. Build and send the email via Gmail ---
    const listHtml = birthdaysToday.length
      ? birthdaysToday
          .map(m => `<li>${escapeHtml(m.name)}${m.phone ? ` — ${escapeHtml(m.phone)}` : ''}</li>`)
          .join('')
      : `<li style="color:#767066;">No real birthdays today — this is a test email triggered manually from the dashboard.</li>`;

    const subject = birthdaysToday.length
      ? `🎂 ${birthdaysToday.length} birthday${birthdaysToday.length > 1 ? 's' : ''} today`
      : '✅ Test reminder — Phenom Teens Church Manager';

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: `Phenom Teens <${GMAIL_USER}>`,
      to: ADMIN_EMAILS.join(', '),
      subject,
      html: `
        <div style="font-family:sans-serif;font-size:15px;color:#181614;">
          <h2 style="margin-bottom:4px;">${birthdaysToday.length ? "Today's Birthdays 🎉" : 'Test Reminder ✅'}</h2>
          <p style="color:#767066;margin-top:0;">Phenom Teens Church Manager</p>
          <ul>${listHtml}</ul>
        </div>
      `,
    });

    return res.status(200).json({
      message: birthdaysToday.length
        ? `Email sent for ${birthdaysToday.length} birthday(s).`
        : `Test email sent to: ${ADMIN_EMAILS.join(', ')}`,
      names: birthdaysToday.map(m => m.name),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
